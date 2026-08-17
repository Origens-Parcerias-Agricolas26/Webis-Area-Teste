/*
===================================================================
 PLATAFORMA WEBGIS - ORIGENS PARCERIAS AGRÍCOLAS
 Propriedade Intelectual e Direitos Reservados:
 Autor / Proprietário: Tiago Ritter Moreira
 Empresa: Origens Parcerias Agrícolas LTDA
===================================================================
*/

const firebaseConfig = {
    apiKey: "AIzaSyA-46x_kEHCsvaEyGO6OqpynL5ook0MKBA",
    authDomain: "origens-webgis.firebaseapp.com",
    projectId: "origens-webgis",
    storageBucket: "origens-webgis.firebasestorage.app",
    messagingSenderId: "277368735288",
    appId: "1:277368735288:web:92b917c6eecf231e5f88cd",
    measurementId: "G-D33YD6CTNK"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let mapLeft = null, mapRight = null, vrateMap = null, seedsMap = null;
let geojsonLayerLeft = null, geojsonLayerRight = null, vrateGeojsonLayer = null, seedsGeojsonLayer = null;
let tileLayerLeft = null, tileLayerRight = null;

let currentUser = null, currentUserRole = "client", currentUserAllowedFarms = [];
let canAccessSampling = false, canAccessVRate = false, canAccessSeeds = false;

let farmsDatabase = {}, usersDatabase = [];
let savedPrescriptionsDatabase = [];
let extraExcelDatabase = [];
let splitPosition = 0.5, isSyncing = false;

let vrateProcessedData = [];
let vrateDoseMap = {};
let vrateUniqueDoses = [];
let vrateCustomGeoJSON = null;

let seedsProcessedData = [];
let seedsDoseMap = {};
let seedsCultivarMap = {};
let seedsUniqueDoses = [];
let seedsUniqueCultivars = [];
let seedsCustomGeoJSON = null;

const CULTIVAR_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#4f46e5', '#059669', '#e11d48'];

function getLatestSafraGeoJSON(fullGeoJSON) {
    if (!fullGeoJSON || !fullGeoJSON.features || !fullGeoJSON.features.length) return fullGeoJSON;
    
    let safrasSet = new Set();
    fullGeoJSON.features.forEach(f => {
        let s = f.properties ? (f.properties.safra_origem || extractSafra(f.properties)) : null;
        if (s && /^\d{4}$/.test(s)) safrasSet.add(s);
    });

    if (!safrasSet.size) return fullGeoJSON;

    let latestSafra = Array.from(safrasSet).sort().pop();

    let filteredFeatures = fullGeoJSON.features.filter(f => {
        let s = f.properties ? (f.properties.safra_origem || extractSafra(f.properties)) : null;
        return !s || s === latestSafra;
    });

    return { type: "FeatureCollection", features: filteredFeatures };
}

function showSection(sec) {
    if (sec === 'landing') {
        document.getElementById('landing-section').classList.remove('hidden');
        document.getElementById('saas-section').classList.add('hidden');
    }
}

async function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await auth.signInWithPopup(provider);
        currentUser = result.user;
        await checkUserAuthorization();
    } catch (error) { alert("Erro no login: " + error.message); }
}

async function logout() {
    try {
        await auth.signOut();
        currentUser = null;
        showSection('landing');
    } catch (e) { console.error(e); }
}

async function checkUserAuthorization() {
    if (!currentUser) return;
    const userEmail = currentUser.email.toLowerCase();
    const adminEmails = ["administrativo@origens.agr.br", "tiagoritter@gmail.com", "tiago.ritter@origens.agr.br"];

    canAccessSampling = false;
    canAccessVRate = false;
    canAccessSeeds = false;

    if (adminEmails.includes(userEmail)) { 
        currentUserRole = "admin"; 
        currentUserAllowedFarms = ["all"];
        canAccessSampling = true;
        canAccessVRate = true;
        canAccessSeeds = true;
    } else {
        try {
            const userDoc = await db.collection("users").doc(userEmail).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                currentUserRole = userData.role || "client";
                currentUserAllowedFarms = userData.farms || [];
                canAccessSampling = !!userData.allowSampling;
                canAccessVRate = !!userData.allowVRate;
                canAccessSeeds = !!userData.allowSeeds;
            } else { 
                alert("Acesso restrito à equipe Origens ou usuários autorizados pelo administrador!"); 
                await auth.signOut(); 
                showSection('landing');
                return; 
            }
        } catch (err) { 
            console.error(err); 
            alert("Erro ao validar permissões na nuvem.");
            await auth.signOut();
            showSection('landing');
            return;
        }
    }

    document.getElementById('landing-section').classList.add('hidden');
    document.getElementById('saas-section').classList.remove('hidden');
    document.getElementById('user-display-name').innerText = currentUser.displayName || currentUser.email;
    document.getElementById('user-display-email').innerText = currentUser.email;

    const roleBadge = document.getElementById('user-display-role');
    const adminExtraExcelControls = document.getElementById('admin-extra-excel-controls');

    if (currentUserRole === 'admin') {
        roleBadge.innerText = "Modo Edição (Admin)";
        roleBadge.className = "inline-block mt-1 px-2 py-0.5 text-[10px] font-black uppercase rounded bg-emerald-700 text-white";
        document.getElementById('admin-only-menu').classList.remove('hidden');
        document.getElementById('upload-box-admin').classList.remove('hidden');
        if (adminExtraExcelControls) adminExtraExcelControls.classList.remove('hidden');
    } else {
        roleBadge.innerText = "Modo Leitura";
        roleBadge.className = "inline-block mt-1 px-2 py-0.5 text-[10px] font-black uppercase rounded bg-slate-700 text-slate-300";
        document.getElementById('admin-only-menu').classList.add('hidden');
        document.getElementById('upload-box-admin').classList.add('hidden');
        if (adminExtraExcelControls) adminExtraExcelControls.classList.add('hidden');
    }

    const tabVrateBtn = document.getElementById('tab-vrate');
    const tabSeedsBtn = document.getElementById('tab-seeds');
    const tabSamplingBtn = document.getElementById('tab-sampling');

    if (tabVrateBtn) canAccessVRate ? tabVrateBtn.classList.remove('hidden') : tabVrateBtn.classList.add('hidden');
    if (tabSeedsBtn) canAccessSeeds ? tabSeedsBtn.classList.remove('hidden') : tabSeedsBtn.classList.add('hidden');
    if (tabSamplingBtn) canAccessSampling ? tabSamplingBtn.classList.remove('hidden') : tabSamplingBtn.classList.add('hidden');

    await loadCloudData();
    initLeafletMap();
}

function getRdYlGnPalette(n) {
    const colors = ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'];
    if (n <= 1) return ['#1a9850'];
    if (n <= colors.length) {
        let res = [];
        for (let i = 0; i < n; i++) {
            let idx = Math.round(i * (colors.length - 1) / (n - 1));
            res.push(colors[idx]);
        }
        return res;
    }
    function hexToRgb(h) {
        h = h.replace('#', '');
        return [parseInt(h.substring(0,2), 16), parseInt(h.substring(2,4), 16), parseInt(h.substring(4,6), 16)];
    }
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    const stops = colors.map(hexToRgb);
    let res = [];
    for (let i = 0; i < n; i++) {
        let t = i / (n - 1);
        let scaledT = t * (stops.length - 1);
        let idx = Math.floor(scaledT);
        if (idx >= stops.length - 1) {
            res.push(rgbToHex(...stops[stops.length - 1]));
        } else {
            let localT = scaledT - idx;
            let c1 = stops[idx], c2 = stops[idx + 1];
            let r = Math.round(c1[0] + (c2[0] - c1[0]) * localT);
            let g = Math.round(c1[1] + (c2[1] - c1[1]) * localT);
            let b = Math.round(c1[2] + (c2[2] - c1[2]) * localT);
            res.push(rgbToHex(r, g, b));
        }
    }
    return res;
}

function parse