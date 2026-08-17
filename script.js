// ==========================================
// 1. VARIÁVEIS GLOBAIS E CONFIGURAÇÃO
// ==========================================
let map = null;
let geojsonLayer = null;
let samplingPointsLayer = null;
let currentGeoJSON = null;
let currentUser = null;
let currentUserRole = 'client'; // 'admin' ou 'client'
let currentUserAllowedFarms = [];
let canAccessSampling = false;
let canAccessVRate = false;
let canAccessSeeds = false;

// Tabela de conversão/paleta de cores para os módulos
const COLOR_PALETTES = {
    vrate: ['#1e293b', '#0f766e', '#047857', '#65a30d', '#facc15', '#f97316', '#dc2626'],
    sampling: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
    seeds: ['#15803d', '#4338ca', '#a21caf', '#b45309']
};

// ==========================================
// 2. INICIALIZAÇÃO DA APLICAÇÃO
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    // Escuta o estado de autenticação do Firebase
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            checkUserAuthorization();
        } else {
            showSection('landing');
        }
    });
});

function showSection(section) {
    const landing = document.getElementById('landing-section');
    const saas = document.getElementById('saas-section');
    if (section === 'saas') {
        landing.classList.add('hidden');
        saas.classList.remove('hidden');
    } else {
        saas.classList.add('hidden');
        landing.classList.remove('hidden');
    }
}

// ==========================================
// 3. AUTENTICAÇÃO E PERMISSÕES
// ==========================================
async function loginWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        currentUser = result.user;
        await checkUserAuthorization();
    } catch (error) {
        console.warn("Autenticação Google/Firebase não configurada ou a correr em modo local. Ativando modo de teste.", error);
        
        // MODO DEMONSTRAÇÃO / FALLBACK LOCAL
        currentUser = {
            displayName: "Produtor (Modo Teste)",
            email: "administrativo@origens.agr.br"
        };
        currentUserRole = "admin";
        canAccessSampling = true;
        canAccessVRate = true;
        canAccessSeeds = true;
        currentUserAllowedFarms = ["all"];

        // Exibe a plataforma SaaS
        showSection('saas');
        
        document.getElementById('user-display-name').innerText = currentUser.displayName;
        document.getElementById('user-display-email').innerText = currentUser.email;

        // Liberar visualização dos menus
        ['tab-vrate', 'tab-seeds', 'tab-sampling', 'admin-only-menu', 'upload-box-admin'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        initLeafletMap();
    }
}

async function logout() {
    try {
        await auth.signOut();
    } catch (e) {
        console.log("Logout executado localmente.");
    }
    currentUser = null;
    showSection('landing');
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
                alert("Acesso restrito à equipa Origens ou utilizadores autorizados!"); 
                await auth.signOut(); 
                showSection('landing');
                return; 
            }
        } catch (err) { 
            console.error("Erro ao verificar utilizador no Firestore:", err); 
        }
    }

    showSection('saas');
    document.getElementById('user-display-name').innerText = currentUser.displayName || currentUser.email;
    document.getElementById('user-display-email').innerText = currentUser.email;

    const roleBadge = document.getElementById('user-display-role');
    const adminExtraExcelControls = document.getElementById('admin-extra-excel-controls');

    if (currentUserRole === 'admin') {
        if (roleBadge) {
            roleBadge.innerText = "Modo Edição (Admin)";
            roleBadge.className = "inline-block mt-1 px-2 py-0.5 text-[10px] font-black uppercase rounded bg-emerald-700 text-white";
        }
        if (document.getElementById('admin-only-menu')) document.getElementById('admin-only-menu').classList.remove('hidden');
        if (document.getElementById('upload-box-admin')) document.getElementById('upload-box-admin').classList.remove('hidden');
        if (adminExtraExcelControls) adminExtraExcelControls.classList.remove('hidden');
    } else {
        if (roleBadge) {
            roleBadge.innerText = "Modo Leitura";
            roleBadge.className = "inline-block mt-1 px-2 py-0.5 text-[10px] font-black uppercase rounded bg-slate-700 text-slate-300";
        }
        if (document.getElementById('admin-only-menu')) document.getElementById('admin-only-menu').classList.add('hidden');
        if (document.getElementById('upload-box-admin')) document.getElementById('upload-box-admin').classList.add('hidden');
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

// ==========================================
// 4. MAPEAMENTO (LEAFLET)
// ==========================================
function initLeafletMap() {
    if (map) return; // Evita reinstanciar o mapa se já existir

    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([-23.5505, -46.6333], 10);

    const googleSat = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    googleSat.addTo(map);
}

function renderGeoJSONOnMap(geojsonData) {
    if (!map) initLeafletMap();

    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    currentGeoJSON = geojsonData;

    geojsonLayer = L.geoJSON(geojsonData, {
        style: function (feature) {
            return {
                fillColor: feature.properties.color || '#10b981',
                weight: 1.5,
                opacity: 1,
                color: '#ffffff',
                fillOpacity: 0.7
            };
        },
        onEachFeature: function (feature, layer) {
            if (feature.properties) {
                let popupContent = '<div class="p-2 text-xs font-sans">';
                for (let key in feature.properties) {
                    if (key !== 'color') {
                        popupContent += `<b>${key}:</b> ${feature.properties[key]}<br>`;
                    }
                }
                popupContent += '</div>';
                layer.bindPopup(popupContent);
            }
        }
    }).addTo(map);

    try {
        const bounds = geojsonLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds);
        }
    } catch (e) {
        console.warn("Não foi possível ajustar o zoom para os limites:", e);
    }
}

// ==========================================
// 5. IMPORTAÇÃO E PROCESSAMENTO DE FICHEIROS
// ==========================================
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
        const reader = new FileReader();
