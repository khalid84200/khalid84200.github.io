// Importations Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, getDoc, addDoc, setDoc, deleteDoc, writeBatch, enableIndexedDbPersistence, query, where, orderBy, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, signInAnonymously, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBQCBlzr-RTDb99gF3sqhvbNIGXcf6OWEg",
    authDomain: "ma-gmao-ca6a5.firebaseapp.com",
    projectId: "ma-gmao-ca6a5",
    storageBucket: "ma-gmao-ca6a5.appspot.com",
    messagingSenderId: "279000639370",
    appId: "1:279000639370:web:6c04f86ba8dc82d097ca73"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- GESTION DE L'AUTHENTIFICATION CENTRALE ---
onAuthStateChanged(auth, async (user) => {
    document.getElementById('loader').style.display = 'none';
    if (user && !user.isAnonymous) {
        const userRef = doc(db, "users", user.uid);
        let userDoc = await getDoc(userRef);
        let userProfile;

        if (!userDoc.exists()) {
            const invitationRef = doc(db, "invitations", user.email.toLowerCase());
            const invitationDoc = await getDoc(invitationRef);
            let orgId, role;
            const defaultProfile = { name: "", surname: "", matricule: "" };

            if (invitationDoc.exists()) {
                orgId = invitationDoc.data().orgId;
                role = 'member';
                userProfile = { email: user.email, role: role, orgId: orgId, ...defaultProfile };
                await setDoc(userRef, userProfile);
                await deleteDoc(invitationRef);
            } else {
                const orgRef = doc(collection(db, "organizations"));
                orgId = orgRef.id;
                role = 'admin';
                userProfile = { email: user.email, role: role, orgId: orgId, ...defaultProfile };
                await setDoc(userRef, userProfile);
                await setDoc(orgRef, { name: `Réseau de ${user.email}`, owner: user.uid, createdAt: new Date().toISOString() });
            }
        }
        
        userDoc = await getDoc(userRef);
        userProfile = userDoc.data();
        GMAOApp.startAppWithUser({ ...user, ...userProfile });

    } else if (user && user.isAnonymous) {
        GMAOApp.startAppWithUser(user);
    } else {
        GMAOApp.showLoginScreen();
    }
});

getRedirectResult(auth).catch(error => { console.error("Redirect Error:", error); GMAOApp.showAlert(`Erreur : ${error.message}`); }).finally(() => { sessionStorage.removeItem('pendingGoogleAuth'); });
enableIndexedDbPersistence(db).catch((err) => { console.warn("Firestore persistence error:", err.code); });

// --- OBJET PRINCIPAL DE L'APPLICATION ---
const GMAOApp = {
    data: { equipments: [], interventions: [], parts: [], members: [], consignes: { text: "" } },
    dashboardFilters: { startDate: null, endDate: null },
    charts: {},
    currentUser: null,
    unsubscribeListeners: [],
    
    startAppWithUser(user) {
        this.currentUser = user;
        this.startApp();
    },

    showLoginScreen() {
        document.querySelector('.app-container').style.display = 'none';
        document.getElementById('auth-container').style.display = 'flex';
        this.unsubscribeListeners.forEach(unsub => unsub());
        this.unsubscribeListeners = [];
        this.setupAuthListeners();
    },
    
    setupAuthListeners() {
        if (this.authListenersAttached) return;
        document.getElementById('login-form').addEventListener('submit', e => this.handleLogin(e));
        document.getElementById('signup-form').addEventListener('submit', e => this.handleSignup(e));
        document.getElementById('show-signup').addEventListener('click', () => { document.getElementById('login-form').style.display = 'none'; document.getElementById('signup-form').style.display = 'block'; });
        document.getElementById('show-login').addEventListener('click', () => { document.getElementById('signup-form').style.display = 'none'; document.getElementById('login-form').style.display = 'block'; });
        document.getElementById('google-signin-btn').addEventListener('click', () => this.handleGoogleLogin());
        document.getElementById('guest-mode-btn').addEventListener('click', () => this.handleGuestLogin());
        this.authListenersAttached = true;
    },

    async handleGuestLogin() { try { await signInAnonymously(auth); } catch (error) { this.showAlert("Impossible de démarrer le mode invité."); } },
    async handleGoogleLogin() { const provider = new GoogleAuthProvider(); try { await signInWithPopup(auth, provider); } catch (error) { if (error.code.includes('popup') || error.code.includes('cancelled')) { signInWithRedirect(auth, provider); } else { this.showAlert(`Erreur : ${error.message}`); } } },
    async handleLogin(e) { e.preventDefault(); const email = document.getElementById('login-email').value; const password = document.getElementById('login-password').value; try { await signInWithEmailAndPassword(auth, email, password); } catch (error) { document.getElementById('login-error-msg').textContent = "Email ou mot de passe incorrect."; } },
    async handleSignup(e) { e.preventDefault(); const email = document.getElementById('signup-email').value; const password = document.getElementById('signup-password').value; try { await createUserWithEmailAndPassword(auth, email, password); } catch (error) { document.getElementById('signup-error-msg').textContent = "Erreur : mot de passe ou email invalide."; } },
    
    startApp() {
        document.getElementById('auth-container').style.display = 'none';
        document.querySelector('.app-container').style.display = 'block';
        this.applyTheme(localStorage.getItem('gmao-theme') || 'light');
        this.setupEventListeners();
        if (this.currentUser.isAnonymous) {
            this.handleGuestModeUI();
        } else {
            this.attachRealtimeListeners();
        }
    },

    handleGuestModeUI() {
        this.addTestData(true);
        this.navigateTo(window.location.hash || '#dashboard');
    },
    
    async attachRealtimeListeners() {
        if (!this.currentUser || !this.currentUser.orgId) {
             signOut(auth);
             return;
        }

        this.unsubscribeListeners.forEach(unsub => unsub());
        this.unsubscribeListeners = [];
        
        const basePath = `organizations/${this.currentUser.orgId}`;

        ['equipments', 'parts'].forEach(colName => {
            const unsub = onSnapshot(collection(db, basePath, colName), (snapshot) => {
                this.data[colName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                this.renderCurrentPage();
            }, (error) => { console.error(`Listen error for ${colName}:`, error); });
            this.unsubscribeListeners.push(unsub);
        });
        
        const interventionsQuery = query(collection(db, basePath, "interventions"), orderBy("date", "desc"));
        const unsubInterventions = onSnapshot(interventionsQuery, (snapshot) => {
            this.data.interventions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderCurrentPage();
        }, (error) => { console.error(`Listen error for interventions:`, error); });
        this.unsubscribeListeners.push(unsubInterventions);

        const membersQuery = query(collection(db, "users"), where("orgId", "==", this.currentUser.orgId));
        const unsubMembers = onSnapshot(membersQuery, (snapshot) => {
            this.data.members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderCurrentPage();
        }, (error) => { console.error("Listen error for members:", error); });
        this.unsubscribeListeners.push(unsubMembers);
        
        const consignesRef = doc(db, basePath, "shared", "consignes");
        const unsubConsignes = onSnapshot(consignesRef, (doc) => {
            this.data.consignes = doc.exists() ? doc.data() : { text: "" };
            this.renderCurrentPage();
        }, (error) => { console.error("Listen error for consignes:", error); });
        this.unsubscribeListeners.push(unsubConsignes);

        this.navigateTo(window.location.hash || '#dashboard');
    },

    renderCurrentPage() {
        const hash = window.location.hash || '#dashboard';
        this.updateUIVisibility();
        switch (hash) {
            case '#dashboard': this.renderDashboard(); break;
            case '#equipments': this.renderListPage('equipments'); break;
            case '#interventions': this.renderInterventionsPage(); break;
            case '#parts': this.renderPartsPage(); break;
            case '#network': this.renderNetworkPage(); break;
            case '#profile': this.renderProfilePage(); break;
        }
    },

    async handleSubmit(event) {
        event.preventDefault();
        if (!await this.checkAuthAndPrompt()) return;
        const form = event.target;
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
        
        const type = form.dataset.type;
        const formData = new FormData(form);
        const id = formData.get('id');
        let itemData = Object.fromEntries(formData.entries());
        delete itemData.id;

        const basePath = `organizations/${this.currentUser.orgId}`;

        try {
            if (type === 'parts' && !id) {
                const newReference = itemData.reference.trim();
                if (newReference && this.data.parts.some(p => p.reference && p.reference.toLowerCase() === newReference.toLowerCase())) {
                    throw new Error("Cette référence de pièce existe déjà.");
                }
            }
            
            if (type === 'interventions') {
                const batch = writeBatch(db);
                const memberProfile = this.data.members.find(m => m.id === this.currentUser.uid);
                itemData.techId = this.currentUser.uid;
                itemData.techName = `${memberProfile.name || ''} ${memberProfile.surname || ''}`.trim();
                itemData.techMatricule = memberProfile.matricule || 'N/A';
                
                const newPartsUsed = {};
                form.querySelectorAll('.used-part-item').forEach(item => {
                    const partId = item.dataset.partId;
                    const qty = parseInt(item.querySelector('input').value, 10);
                    if (qty > 0) newPartsUsed[partId] = qty;
                });
                itemData.partsUsed = newPartsUsed;

                const oldIntervention = id ? this.data.interventions.find(i => i.id === id) : null;
                const oldPartsUsed = oldIntervention?.partsUsed || {};
                const wasCompleted = oldIntervention?.status === 'completed';
                const isNowCompleted = itemData.status === 'completed';

                const allPartIds = new Set([...Object.keys(oldPartsUsed), ...Object.keys(itemData.partsUsed)]);
                for (const partId of allPartIds) {
                    const oldQty = wasCompleted ? (oldPartsUsed[partId] || 0) : 0;
                    const newQty = isNowCompleted ? (itemData.partsUsed[partId] || 0) : 0;
                    const change = oldQty - newQty;

                    if (change !== 0) {
                        const partRef = doc(db, `${basePath}/parts`, partId);
                        const partData = this.data.parts.find(p => p.id === partId);
                        if (!partData) throw new Error(`Pièce ${partId} non trouvée dans le cache local.`);
                        
                        const currentQuantity = Number(partData.quantity);
                        const newQuantity = currentQuantity + change;
                        if (newQuantity < 0) throw new Error(`Stock insuffisant pour ${partData.name}.`);

                        batch.update(partRef, { quantity: newQuantity });
                    }
                }
                
                if (id) {
                    batch.set(doc(db, `${basePath}/interventions`, id), itemData, { merge: true });
                } else {
                    itemData.otNumber = `OT-${Date.now()}`;
                    batch.set(doc(collection(db, `${basePath}/interventions`)), itemData);
                }
                await batch.commit();

            } else {
                if (id) {
                    await setDoc(doc(db, `${basePath}/${type}`, id), itemData, { merge: true });
                } else {
                    await addDoc(collection(db, `${basePath}/${type}`), itemData);
                }
            }
            this.closeModal('formModal');
        } catch (e) {
            console.error("Firestore Submit Error:", e);
            this.showAlert("Erreur d'enregistrement: " + e.message);
        } finally {
             submitButton.disabled = false;
             submitButton.innerHTML = 'Enregistrer';
        }
    },
    
    renderDashboard() {
        if (this.currentUser.isAnonymous) {
            document.getElementById('guest-info-card').style.display = 'block';
            document.getElementById('test-data-card').style.display = 'none';
        } else if (this.data.equipments.length === 0 && this.currentUser.role === 'admin') {
            document.getElementById('guest-info-card').style.display = 'none';
            document.getElementById('test-data-card').style.display = 'block';
        } else {
            document.getElementById('guest-info-card').style.display = 'none';
            document.getElementById('test-data-card').style.display = 'none';
        }
        
        const dateStartInput = document.getElementById('date-start'), dateEndInput = document.getElementById('date-end');
        if (!this.dashboardFilters.startDate || !this.dashboardFilters.endDate) { const endDate = new Date(), startDate = new Date(); startDate.setDate(endDate.getDate() - 30); this.dashboardFilters.startDate = startDate.toISOString().slice(0, 10); this.dashboardFilters.endDate = endDate.toISOString().slice(0, 10); }
        dateStartInput.value = this.dashboardFilters.startDate; dateEndInput.value = this.dashboardFilters.endDate;
        document.getElementById('filter-btn').onclick = () => { this.dashboardFilters.startDate = dateStartInput.value; this.dashboardFilters.endDate = dateEndInput.value; this.renderDashboard(); };
        const filteredInterventions = this.getFilteredInterventions(this.dashboardFilters);
        
        const recentList = document.getElementById('recent-interventions-list');
        recentList.innerHTML = this.data.interventions.length ? this.data.interventions.slice(0, 5).map(item => this.getItemTemplate('interventions', item)).join('') : `<div class="loading-message">Aucune intervention récente.</div>`;
        
        this.calculateAndDisplayKPIs(filteredInterventions);
        this.renderAnalysisCharts(filteredInterventions);
        
        const typeCounts = filteredInterventions.reduce((acc, item) => { const type = item.type || "N/D"; acc[type] = (acc[type] || 0) + 1; return acc; }, {});
        const labels = Object.keys(typeCounts);
        const data = Object.values(typeCounts);
        const backgroundColors = labels.map(label => {
            if (label === 'Corrective') return getComputedStyle(document.documentElement).getPropertyValue('--warning-color');
            if (label === 'Préventive') return getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
            return '#ccc';
        });
        this.createChart('ratioChartCanvas', 'doughnut', { labels: labels, datasets: [{ data: data, backgroundColor: backgroundColors }] }, { plugins: { legend: { position: 'top' } } });

        document.getElementById('export-downtime-btn').onclick = () => this.handleExportDowntime(false);
        document.getElementById('export-24h-downtime-btn').onclick = () => this.handleExportDowntime(true);
    },

    renderListPage(type) {
        const searchTerm = document.getElementById(`${type.slice(0, -1)}-search`).value;
        this.renderList(type, this.data[type], searchTerm);
    },

    renderInterventionsPage() {
        ['intervention-date-start', 'intervention-date-end'].forEach(id => { document.getElementById(id).oninput = () => this.renderInterventionsPage(); });
        document.getElementById('intervention-search').oninput = () => this.renderInterventionsPage();
        
        const startDate = document.getElementById('intervention-date-start').value;
        const endDate = document.getElementById('intervention-date-end').value;

        let filteredByDate = this.data.interventions;
        if (startDate || endDate) {
             filteredByDate = this.getFilteredInterventions({ startDate, endDate });
        }
        
        const searchTerm = document.getElementById('intervention-search').value.toLowerCase();
        const filteredBySearch = filteredByDate.filter(item => (item.desc.toLowerCase().includes(searchTerm)) || (item.otNumber && item.otNumber.toLowerCase().includes(searchTerm)));
        
        this.renderList('interventions', filteredBySearch, '');
    },
    
    renderPartsPage() {
        document.getElementById('export-stock-btn').onclick = () => this.handleExportStock();
        const supplierFilter = document.getElementById('supplier-filter'), reorderFilter = document.getElementById('reorder-filter'), searchInput = document.getElementById('part-search'), totalStockValueEl = document.getElementById('total-stock-value');
        const suppliers = [...new Set(this.data.parts.map(p => p.supplier))].filter(Boolean); supplierFilter.innerHTML = `<option value="">Tous</option>` + suppliers.map(s => `<option value="${s}">${s}</option>`).join('');
        const totalValue = this.data.parts.reduce((total, part) => total + (Number(part.quantity) * Number(part.unitPrice || 0)), 0); totalStockValueEl.textContent = `${totalValue.toFixed(2)} Dhs.`;
        const applyFilters = () => { const selectedSupplier = supplierFilter.value; const needsReorder = reorderFilter.checked; const searchTerm = searchInput.value.toLowerCase(); let filteredParts = this.data.parts; if (selectedSupplier) { filteredParts = filteredParts.filter(p => p.supplier === selectedSupplier); } if (needsReorder) { filteredParts = filteredParts.filter(p => Number(p.quantity) <= Number(p.minQuantity)); } if (searchTerm) { filteredParts = filteredParts.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.reference && p.reference.toLowerCase().includes(searchTerm))); } this.renderList('parts', filteredParts, ''); };
        supplierFilter.onchange = applyFilters; reorderFilter.onchange = applyFilters; searchInput.oninput = applyFilters; applyFilters();
    },

    renderNetworkPage() {
        const consignesDisplay = document.getElementById('consignes-display');
        const consignesEdit = document.getElementById('consignes-edit');
        const consignesTextarea = document.getElementById('consignes-textarea');
        if (this.currentUser.role === 'admin') {
            consignesDisplay.style.display = 'none';
            consignesEdit.style.display = 'block';
            consignesTextarea.value = this.data.consignes.text;
        } else {
            consignesDisplay.style.display = 'block';
            consignesEdit.style.display = 'none';
            consignesDisplay.textContent = this.data.consignes.text || "Aucune consigne pour le moment.";
        }

        const searchTerm = document.getElementById('member-search').value;
        this.renderList('members', this.data.members, searchTerm);
    },

    renderProfilePage() {
        const memberProfile = this.data.members.find(m => m.id === this.currentUser.uid);
        if (memberProfile) {
            document.getElementById('profile-email').value = memberProfile.email || '';
            document.getElementById('profile-surname').value = memberProfile.surname || '';
            document.getElementById('profile-name').value = memberProfile.name || '';
            document.getElementById('profile-matricule').value = memberProfile.matricule || '';
        }
    },
    
    updateUIVisibility() {
        this.updateLowStockNotification();
        const hash = window.location.hash || '#dashboard';
        const fab = document.getElementById('fab-add-button');
        
        const isAnonymous = this.currentUser.isAnonymous;
        document.getElementById('nav-network-btn').style.display = isAnonymous ? 'none' : 'flex';
        document.getElementById('nav-profile-btn').style.display = isAnonymous ? 'none' : 'flex';
        
        if (document.getElementById('consignes-card')) {
            document.getElementById('consignes-card').style.display = isAnonymous ? 'none' : 'block';
        }

        if (document.getElementById('network-management-card')) {
            document.getElementById('network-management-card').style.display = this.currentUser.role === 'admin' ? 'block' : 'none';
        }

        const pagesWithoutFab = ['#dashboard', '#network', '#profile', ''];
        fab.style.display = pagesWithoutFab.includes(hash) ? 'none' : 'flex';
    },

    openForm(type, id = null, dataToPreload = null) {
        const form = document.getElementById('mainForm');
        const modalTitle = document.getElementById('modalTitle');
        let html = '', title = '', item = null;

        if (id) item = this.data[type].find(d => d.id === id);
        if (dataToPreload) item = dataToPreload;
        
        switch (type) {
            case 'interventions':
                item = item || {};
                title = id ? 'Modifier Intervention' : 'Nouvelle Intervention';
                const eqOptions = this.data.equipments.map(e => `<option value="${e.id}">${e.uniqueId || e.name}</option>`).join('');
                
                let assignedMemberIdentifier;
                if (id) {
                    assignedMemberIdentifier = `${item.techName || ''} (${item.techMatricule || 'N/A'})`;
                } else {
                    const memberProfile = this.data.members.find(m => m.id === this.currentUser.uid);
                    assignedMemberIdentifier = `${memberProfile.name || ''} ${memberProfile.surname || ''} (${memberProfile.matricule || 'N/A'})`.trim();
                }

                html = `<input type="hidden" name="id" value="${item.id || ''}">
                        <div class="form-group"><label>Description</label><input type="text" name="desc" class="form-control" value="${item.desc || ''}" required></div>
                        <div class="form-group"><label>Date</label><input type="date" name="date" class="form-control" value="${item.date || new Date().toISOString().slice(0,10)}" required></div>
                        <div class="form-group"><label>Type</label><select name="type" class="form-control"><option>Corrective</option><option>Préventive</option></select></div>
                        <div class="form-group"><label>Statut</label><select name="status" class="form-control"><option>planned</option><option>progress</option><option>completed</option></select></div>
                        <div class="form-group"><label>Équipement</label><select name="eqId" class="form-control">${eqOptions}</select></div>
                        <div class="form-group"><label>Membre Assigné</label><input type="text" class="form-control" value="${assignedMemberIdentifier}" disabled></div>
                        <hr>
                        <div class="form-group"><label>Début intervention</label><input type="datetime-local" name="downtimeStart" class="form-control" value="${item.downtimeStart || ''}"></div>
                        <div class="form-group"><label>Fin intervention</label><input type="datetime-local" name="downtimeEnd" class="form-control" value="${item.downtimeEnd || ''}"></div>
                        <hr>
                        <div class="form-group"><label>Pièces utilisées</label><div id="used-parts-container"></div><input type="text" id="part-search-input" class="form-control" placeholder="Rechercher une pièce..."><div class="parts-search-results" id="parts-search-results"></div></div>`;
                break;
             case 'parts': 
                item = item || {}; 
                const isEditing = !!id;
                title = dataToPreload ? 'Cloner Pièce' : (isEditing ? 'Modifier Pièce' : 'Nouvelle Pièce'); 
                html = `<input type="hidden" name="id" value="${dataToPreload ? '' : (item.id || '')}">
                        <div class="form-group"><label>Nom</label><input type="text" name="name" class="form-control" value="${item.name || ''}" required></div>
                        <div class="form-group"><label>Référence</label><input type="text" name="reference" class="form-control" value="${dataToPreload ? '' : (item.reference || '')}" placeholder="${dataToPreload ? 'Nouvelle référence unique' : ''}" required></div>
                        <div class="form-group"><label>Fournisseur</label><input type="text" name="supplier" class="form-control" value="${item.supplier || ''}"></div>
                        <div class="form-group"><label>Prix Unitaire</label><input type="number" step="0.01" name="unitPrice" class="form-control" value="${item.unitPrice || 0}"></div>
                        <div class="form-group"><label>Quantité</label><input type="number" name="quantity" class="form-control" value="${dataToPreload ? 0 : (item.quantity || 0)}" ${isEditing ? 'readonly' : ''} required></div>
                        <div class="form-group"><label>Quantité Min</label><input type="number" name="minQuantity" class="form-control" value="${item.minQuantity || 0}" required></div>
                        <div class="form-group"><label>Délai Livraison (jours)</label><input type="number" name="delaiLivraison" class="form-control" value="${item.delaiLivraison || 0}"></div>`; 
                break; 
             case 'equipments': 
                item = item || {}; 
                title = id ? 'Modifier Équipement' : 'Nouvel Équipement'; 
                html = `<input type="hidden" name="id" value="${item.id || ''}">
                        <div class="form-group"><label>Nom</label><input type="text" name="name" class="form-control" value="${item.name || ''}" required></div>
                        <div class="form-group"><label>Identifiant (ID)</label><input type="text" name="uniqueId" class="form-control" value="${item.uniqueId || ''}" required></div>
                        <div class="form-group"><label>N° de Série</label><input type="text" name="serialNumber" class="form-control" value="${item.serialNumber || ''}"></div>`; 
                break;
        }
        form.innerHTML = html + `<button type="submit" class="btn btn-full">Enregistrer</button>${(id && !dataToPreload) ? `<button type="button" id="form-delete-btn" class="btn btn-full btn-danger" style="margin-top:10px;">Supprimer</button>` : ''}`;
        
        if(id || dataToPreload){ 
            Object.keys(item).forEach(key => { if(form.elements[key]) form.elements[key].value = item[key]; }); 
            if (type === 'interventions') {
                 form.elements['type'].value = item.type;
                 form.elements['status'].value = item.status;
                 this.prefillUsedParts(item.partsUsed);
            }
        }
        if (type === 'interventions') this.setupPartSearch();
        if (id) document.getElementById('form-delete-btn')?.addEventListener('click', () => this.deleteItem(type, id));
        modalTitle.textContent = title;
        form.dataset.type = type;
        this.openModal('formModal');
    },

    clonePart(id) {
        const partToClone = this.data.parts.find(p => p.id === id);
        if (partToClone) {
            const clonedData = { ...partToClone };
            delete clonedData.id;
            this.openForm('parts', null, clonedData);
        }
    },

    renderList(type, data, searchTerm = '') {
        const listElementId = type === 'members' ? 'members-list' : `${type}-list`;
        const listElement = document.getElementById(listElementId);
        if (!listElement) return;
        const lowerSearchTerm = searchTerm.toLowerCase();
        const filteredData = searchTerm ? data.filter(item => 
            (item.name && (item.name + " " + item.surname).toLowerCase().includes(lowerSearchTerm)) || 
            (item.matricule && item.matricule.toLowerCase().includes(lowerSearchTerm)) ||
            (item.email && item.email.toLowerCase().includes(lowerSearchTerm)) ||
            (item.desc && item.desc.toLowerCase().includes(lowerSearchTerm))
        ) : data;
        listElement.innerHTML = filteredData.length > 0 ? filteredData.map(item => this.getItemTemplate(type, item)).join('') : `<div class="loading-message">Aucun élément trouvé.</div>`;
    },

    getItemTemplate(type, item) {
        let icon, title, subtitle = '', actions = '', details = '', clickableClass = 'list-item-clickable';
        switch (type) {
            case 'equipments': icon = `<div class="item-icon bg-blue"><i class="fas fa-cogs"></i></div>`; title = item.uniqueId ? `${item.uniqueId} - ${item.name}` : item.name; subtitle = `N/S: ${item.serialNumber || 'N/A'}`; actions = `<i class="fas fa-edit action-icon" data-action="edit"></i><i class="fas fa-qrcode action-icon" data-action="qr"></i>`; break;
            case 'interventions': 
                const eq = this.data.equipments.find(e => e.id === item.eqId); 
                const memberName = item.techName || (item.techMatricule || 'N/A');
                const interventionColor = item.type === 'Corrective' ? 'bg-orange' : 'bg-blue';
                icon = `<div class="item-icon ${interventionColor}"><i class="fas fa-wrench"></i></div>`; 
                title = `${item.otNumber || ''}: ${item.desc}`; 
                subtitle = `${eq ? eq.name : 'Équipement'} | ${memberName}`; 
                if (item.downtimeStart && item.downtimeEnd) {
                    const duration = new Date(item.downtimeEnd) - new Date(item.downtimeStart);
                    details = `<div class="item-details"><span class="detail-badge"><i class="fas fa-clock"></i> ${this.formatDuration(duration)}</span></div>`;
                }
                const statusClasses = { planned: 'status-planned', progress: 'status-progress', completed: 'status-completed' }; 
                actions = `<span class="status-badge ${statusClasses[item.status]}">${item.status}</span>`; 
                break;
            case 'parts': 
                icon = `<div class="item-icon bg-grey"><i class="fas fa-box"></i></div>`; 
                title = item.name; 
                subtitle = `Réf: ${item.reference || 'N/A'}`; 
                const stock = Number(item.quantity); 
                const minStock = Number(item.minQuantity); 
                const stockClass = stock <= minStock ? 'status-low-stock' : 'status-ok-stock'; 
                actions = `<div class="item-actions-grid">
                            <span class="status-badge status-info">Fourn: ${item.supplier || '--'}</span>
                            <span class="status-badge status-info">Délai: ${item.delaiLivraison || '--'}j</span>
                            <span class="status-badge status-info">Min: ${minStock}</span>
                            <span class="status-badge ${stockClass}">Stock: ${stock}</span>
                           </div>
                           <div class="item-action-icons">
                             <i class="fas fa-clone action-icon" data-action="clone" title="Cloner"></i>
                             <i class="fas fa-edit action-icon" data-action="edit" title="Modifier"></i>
                           </div>`; 
                break;
            case 'members': 
                const isOwner = item.role === 'admin'; 
                icon = `<div class="item-icon ${isOwner ? 'bg-purple' : 'bg-green'}"><i class="fas ${isOwner ? 'fa-user-shield' : 'fa-user'}"></i></div>`; 
                title = `${item.name || ''} ${item.surname || ''}`.trim() || item.email;
                subtitle = `Matricule: ${item.matricule || 'Non défini'}`;
                actions = `<span class="status-badge ${isOwner ? 'status-planned' : 'status-info'}">${isOwner ? 'Admin' : 'Membre'}</span>`; 
                if (this.currentUser.role === 'admin' && item.id !== this.currentUser.uid) {
                    actions += `<i class="fas fa-trash-alt action-icon-delete" data-action="delete-member" title="Supprimer le membre"></i>`;
                }
                clickableClass = ''; 
                break;
        }
        return `<li class="list-item ${clickableClass}" data-type="${type}" data-id="${item.id}">${icon}<div class="item-info"><div class="item-title">${title}</div><div class="item-subtitle">${subtitle}</div>${details}</div><div class="item-actions">${actions}</div></li>`;
    },

    async inviteUser(event) {
        event.preventDefault();
        const emailToInvite = document.getElementById('invite-email').value;
        if (!emailToInvite || !this.currentUser.orgId) { this.showAlert("Veuillez entrer un email valide."); return; }
        try {
            const invitationRef = doc(db, "invitations", emailToInvite.toLowerCase());
            await setDoc(invitationRef, { orgId: this.currentUser.orgId, invitedBy: this.currentUser.email });
            this.showAlert(`Invitation envoyée à ${emailToInvite}.`);
            document.getElementById('invite-email').value = '';
        } catch (error) { console.error("Invite Error:", error); this.showAlert("L'invitation a échoué."); }
    },
    
    setupEventListeners() {
        if (this.eventListenersAttached) return;
        document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
        window.addEventListener('hashchange', () => this.navigateTo(window.location.hash));
        document.querySelector('.bottom-nav').addEventListener('click', e => { const navItem = e.target.closest('.nav-item'); if (navItem) { e.preventDefault(); this.navigateTo(navItem.getAttribute('href')); } });
        document.getElementById('fab-add-button').addEventListener('click', async () => { if (!await this.checkAuthAndPrompt()) return; const page = (window.location.hash || '#dashboard').substring(1); const creatablePages = ['equipments', 'interventions', 'parts']; if (creatablePages.includes(page)) this.openForm(page); });
        document.querySelectorAll('.modal').forEach(modal => { modal.addEventListener('click', e => { if (e.target === modal || e.target.classList.contains('close-modal')) this.closeModal(modal.id); }); });
        document.getElementById('mainForm').addEventListener('submit', (e) => this.handleSubmit(e));
        document.querySelector('.theme-switcher').addEventListener('click', () => this.toggleTheme());
        document.getElementById('add-test-data-btn').addEventListener('click', () => this.addTestData());
        document.getElementById('invite-form').addEventListener('submit', (e) => this.inviteUser(e));
        document.getElementById('member-search').addEventListener('input', () => this.renderNetworkPage());
        document.getElementById('save-consignes-btn').addEventListener('click', () => this.saveConsignes());
        document.getElementById('profile-form').addEventListener('submit', (e) => this.handleProfileUpdate(e));
        document.querySelector('.app-container').addEventListener('click', e => { const listItem = e.target.closest('.list-item'); if (!listItem) return; const actionIcon = e.target.closest('.action-icon, .action-icon-delete'); const type = listItem.dataset.type; const id = listItem.dataset.id; if (actionIcon) { e.stopPropagation(); const action = actionIcon.dataset.action; if (action === 'edit') this.openForm(type, id); else if (action === 'qr') this.showQRCode(id); else if (action === 'clone') this.clonePart(id); else if (action === 'delete-member') this.deleteMember(id); } else if (listItem.classList.contains('list-item-clickable')) { switch(type) { case 'equipments': this.showEquipmentDetails(id); break; case 'parts': this.showPartDetails(id); break; case 'interventions': this.openForm(type, id); break; } } });
        this.eventListenersAttached = true;
    },

    async handleProfileUpdate(event) {
        event.preventDefault();
        const form = event.target;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;

        const profileData = {
            surname: document.getElementById('profile-surname').value,
            name: document.getElementById('profile-name').value,
            matricule: document.getElementById('profile-matricule').value
        };

        try {
            const userRef = doc(db, "users", this.currentUser.uid);
            await updateDoc(userRef, profileData);
            this.showAlert("Profil mis à jour avec succès !");
        } catch (error) {
            console.error("Profile update error:", error);
            this.showAlert("Erreur lors de la mise à jour du profil.");
        } finally {
            button.disabled = false;
        }
    },
    
    async saveConsignes() {
        const text = document.getElementById('consignes-textarea').value;
        const consignesRef = doc(db, `organizations/${this.currentUser.orgId}/shared/consignes`);
        try {
            await setDoc(consignesRef, { text: text, lastUpdated: new Date().toISOString() });
            this.showAlert("Consignes enregistrées.");
        } catch (error) {
            console.error("Error saving consignes:", error);
            this.showAlert("Erreur lors de l'enregistrement.");
        }
    },
    
    calculateAndDisplayKPIs(interventions) { const { startDate, endDate } = this.dashboardFilters; const correctiveCompleted = interventions.filter(i => i.type === 'Corrective' && i.status === 'completed' && i.downtimeStart && i.downtimeEnd); const totalDowntime = correctiveCompleted.reduce((acc, i) => acc + (new Date(i.downtimeEnd) - new Date(i.downtimeStart)), 0); let availability = 100.0; if (startDate && endDate) { const totalPeriod = new Date(endDate) - new Date(startDate); if (totalPeriod > 0) { const uptime = Math.max(0, totalPeriod - totalDowntime); availability = (uptime / totalPeriod) * 100; } } document.getElementById('kpi-availability-value').textContent = `${availability.toFixed(1)}%`; this.createChart('availabilityChart', 'doughnut', { datasets: [{ data: [availability, 100 - availability], backgroundColor: ['#7ED321', getComputedStyle(document.documentElement).getPropertyValue('--border-color')], borderWidth: 0, cutout: '70%' }] }, { plugins: { tooltip: { enabled: false } } }); const mttr = correctiveCompleted.length > 0 ? totalDowntime / correctiveCompleted.length : 0; document.getElementById('kpi-mttr').textContent = this.formatDuration(mttr); let mtbf = 0; if (correctiveCompleted.length > 1) { const sorted = correctiveCompleted.sort((a, b) => new Date(a.downtimeStart) - new Date(b.downtimeStart)); let totalUptimeForMtbf = 0; for (let i = 1; i < sorted.length; i++) { const uptime = new Date(sorted[i].downtimeStart) - new Date(sorted[i - 1].downtimeEnd); if (uptime > 0) totalUptimeForMtbf += uptime; } mtbf = totalUptimeForMtbf / (sorted.length - 1); } document.getElementById('kpi-mtbf').textContent = this.formatDuration(mtbf, true); },
    renderAnalysisCharts(allFilteredInterventions) { const msToHours = ms => ms / 3600000; const interventionsWithDowntime = allFilteredInterventions.filter(i => i.status === 'completed' && i.downtimeStart && i.downtimeEnd); const downtimeByEquipment = interventionsWithDowntime.reduce((acc, i) => { const downtime = new Date(i.downtimeEnd) - new Date(i.downtimeStart); acc[i.eqId] = (acc[i.eqId] || 0) + downtime; return acc; }, {}); const sortedEquipment = Object.entries(downtimeByEquipment).sort(([, a], [, b]) => b - a).slice(0, 3); const eqLabels = sortedEquipment.map(([id]) => this.data.equipments.find(e => e.id === id)?.name || 'N/A'); const eqData = sortedEquipment.map(([, downtime]) => msToHours(downtime)); this.createChart('downtimeByEquipmentChart', 'bar', { labels: eqLabels, datasets: [{ label: "Heures d'arrêt", data: eqData, backgroundColor: '#D0021B' }] }, { indexAxis: 'y', plugins: { legend: { display: false } } }); },
    createChart(canvasId, type, data, options = {}) { if(!document.getElementById(canvasId)) return; if (this.charts[canvasId]) this.charts[canvasId].destroy(); const ctx = document.getElementById(canvasId).getContext('2d'); this.charts[canvasId] = new Chart(ctx, { type, data, options: { responsive: true, ...options } }); },
    navigateTo(hash) { const newHash = hash || '#dashboard'; document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active')); const newPage = document.querySelector(newHash); if (newPage) newPage.classList.add('active'); document.querySelectorAll('.nav-item').forEach(n => { n.classList.toggle('active', n.getAttribute('href') === newHash); }); window.location.hash = newHash; this.renderCurrentPage(); },
    openModal(modalId) { document.getElementById(modalId).classList.add('active'); },
    closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); },
    showQRCode(id) { const eq = this.data.equipments.find(e => e.id === id); if(!eq) return; const qrContainer = document.getElementById('qrCodeCanvas'); qrContainer.innerHTML = ''; document.getElementById('qrEquipmentName').textContent = eq.name; new QRCode(qrContainer, { text: `gmao://equipment/${eq.id}`, width: 200, height: 200 }); this.openModal('qrModal'); },
    toggleTheme() { const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark'; this.applyTheme(newTheme); localStorage.setItem('gmao-theme', newTheme); },
    applyTheme(theme) { const icon = document.querySelector('.theme-switcher'); if (theme === 'dark') { document.body.classList.add('dark-mode'); icon.classList.replace('fa-moon', 'fa-sun'); } else { document.body.classList.remove('dark-mode'); icon.classList.replace('fa-sun', 'fa-moon'); } },
    formatDuration(ms, long = false) { if (ms <= 0 || !ms) return long ? "0j 0h 0m" : "0m"; const days = Math.floor(ms / 86400000); const hours = Math.floor((ms % 86400000) / 3600000); const minutes = Math.floor((ms % 3600000) / 60000); if (long) return `${days}j ${hours}h ${minutes}m`; let result = ''; if (days > 0) result += `${days}j `; if (hours > 0) result += `${hours}h `; result += `${minutes}m`; return result.trim() || "0m"; },
    updateLowStockNotification() { const needsReorder = this.data.parts.some(p => Number(p.quantity) <= Number(p.minQuantity)); document.querySelector('.nav-item[href="#parts"] .notification-dot').style.display = needsReorder ? 'block' : 'none'; },
    async addTestData(localOnly = false) { const testDataContent = { equipments: [ { id: "eq1", name: "Presse Hydraulique P1", uniqueId: "PRE-001" }, { id: "eq2", name: "Robot de soudure R2", uniqueId: "ROB-002" } ], parts: [ { name: "Filtre à huile H-123", reference: "F-5540", quantity: 12, minQuantity: 5 }, { name: "Roulement 6204-2RS", reference: "R-6204", quantity: 3, minQuantity: 4 } ], interventions: [ { eqId: "eq1", techId: "placeholder_uid", desc: "Surchauffe hydraulique", type: "Corrective", date: "2025-08-22", status: "completed" } ] }; if (localOnly) { Object.keys(testDataContent).forEach(key => { this.data[key] = testDataContent[key].map(item => ({...item, id: item.id || crypto.randomUUID()})); }); this.data.members = [{email: "vous@exemple.com", role:"admin"}]; this.renderCurrentPage(); return; } if (!this.currentUser || !this.currentUser.orgId) return; testDataContent.interventions[0].techId = this.currentUser.uid; const btn = document.getElementById('add-test-data-btn'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ajout...'; } const batch = writeBatch(db); const basePath = `organizations/${this.currentUser.orgId}`; try { testDataContent.equipments.forEach(item => batch.set(doc(db, basePath, "equipments", item.id), item)); testDataContent.parts.forEach(item => batch.set(doc(collection(db, basePath, "parts")), item)); testDataContent.interventions.forEach(item => batch.set(doc(collection(db, basePath, "interventions")), item)); await batch.commit(); this.showAlert("Données de test ajoutées !"); } catch (e) { console.error("Test Data Error: ", e); this.showAlert("Erreur lors de l'ajout des données."); } finally { if (btn) { btn.disabled = false; btn.textContent = 'Ajouter Données de Test'; } } },
    async deleteItem(type, id) { if (!await this.checkAuthAndPrompt() || !await this.showConfirm('Voulez-vous vraiment supprimer cet élément ?')) return; const path = `organizations/${this.currentUser.orgId}/${type}/${id}`; try { await deleteDoc(doc(db, path)); this.closeModal('formModal'); } catch (e) { console.error("Firestore Delete Error:", e); this.showAlert("La suppression a échoué."); } },
    
    async deleteMember(memberId) {
        const memberToDelete = this.data.members.find(m => m.id === memberId);
        if (!memberToDelete) return;

        const confirmed = await this.showConfirm(`Voulez-vous vraiment supprimer ${memberToDelete.name || memberToDelete.email} du réseau ?`);
        if (!confirmed) return;

        try {
            const userRef = doc(db, "users", memberId);
            await updateDoc(userRef, { orgId: null });
            this.showAlert(`${memberToDelete.email} a été supprimé(e) du réseau.`);
        } catch (error) {
            console.error("Error removing member:", error);
            this.showAlert("Erreur lors de la suppression du membre.");
        }
    },

    async checkAuthAndPrompt() { if (this.currentUser && this.currentUser.isAnonymous) { this.openModal('auth-prompt-modal'); document.getElementById('prompt-google-btn').onclick = () => { this.closeModal('auth-prompt-modal'); this.handleGoogleLogin(); }; document.getElementById('prompt-email-btn').onclick = () => { this.closeModal('auth-prompt-modal'); signOut(auth); }; return false; } return true; },
    showAlert(message, title = 'Information') { document.getElementById('custom-alert-title').textContent = title; document.getElementById('custom-alert-message').textContent = message; const modal = document.getElementById('custom-alert-modal'); modal.classList.add('active'); document.getElementById('custom-alert-ok').onclick = () => modal.classList.remove('active'); },
    showConfirm(message, title = 'Confirmation') { return new Promise((resolve) => { document.getElementById('custom-confirm-title').textContent = title; document.getElementById('custom-confirm-message').textContent = message; const modal = document.getElementById('custom-confirm-modal'); modal.classList.add('active'); document.getElementById('custom-confirm-ok').onclick = () => { modal.classList.remove('active'); resolve(true); }; document.getElementById('custom-confirm-cancel').onclick = () => { modal.classList.remove('active'); resolve(false); }; }); },
    getFilteredInterventions(filters) { const { startDate, endDate } = filters; if (!startDate && !endDate) return this.data.interventions; return this.data.interventions.filter(i => { const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }); },
    setupPartSearch() { const searchInput = document.getElementById('part-search-input'); const searchResults = document.getElementById('parts-search-results'); searchInput.addEventListener('input', () => { const term = searchInput.value.toLowerCase(); if (term.length < 2) { searchResults.innerHTML = ''; return; } const results = this.data.parts.filter(p => p.name.toLowerCase().includes(term) || (p.reference && p.reference.toLowerCase().includes(term))); searchResults.innerHTML = results.map(p => `<div data-part-id="${p.id}">${p.name} - Réf: ${p.reference || 'N/A'} (Stock: ${p.quantity})</div>`).join(''); }); searchResults.addEventListener('click', e => { if (e.target.dataset.partId) { const partId = e.target.dataset.partId; const part = this.data.parts.find(p => p.id === partId); this.addPartToUsedList(part); searchInput.value = ''; searchResults.innerHTML = ''; } }); },
    addPartToUsedList(part, quantity = 1) { const container = document.getElementById('used-parts-container'); if (container.querySelector(`[data-part-id="${part.id}"]`)) return; const item = document.createElement('div'); item.className = 'used-part-item'; item.dataset.partId = part.id; item.innerHTML = `<span>${part.name}</span><input type="number" class="form-control" value="${quantity}" min="1" max="${part.quantity}"><button type="button" class="remove-part-btn"><i class="fas fa-times-circle"></i></button>`; item.querySelector('.remove-part-btn').addEventListener('click', () => item.remove()); container.appendChild(item); },
    prefillUsedParts(partsUsed) { if (!partsUsed) return; for (const partId in partsUsed) { const part = this.data.parts.find(p => p.id === partId); if (part) { this.addPartToUsedList(part, partsUsed[partId]); } } },
    
    exportToCSV(dataRows, filename) {
        const csvHeader = "sep=;\n";
        const csvContent = dataRows.map(row => 
            row.map(field => {
                const escaped = ('' + (field === null || field === undefined ? '' : field)).replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(';')
        ).join('\n');
        const blob = new Blob([csvHeader + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    handleExportStock() {
        const startDate = new Date(document.getElementById('stock-date-start').value);
        const endDate = new Date(document.getElementById('stock-date-end').value);
        endDate.setHours(23, 59, 59, 999);
        const headers = ['Nom', 'Reference', 'Fournisseur', 'Quantite_Actuelle', 'StockMin', 'PrixUnitaire', 'Valeur_Stock_Article', 'Quantite_Consommee_Periode', 'Quantite_Approvisionnee_Periode'];
        const data = this.data.parts.map(p => {
            let consumed = 0;
            this.data.interventions.forEach(i => { const iDate = new Date(i.date); if (i.status === 'completed' && i.partsUsed && i.partsUsed[p.id] && iDate >= startDate && iDate <= endDate) { consumed += i.partsUsed[p.id]; } });
            let supplied = 0;
            if(p.history) { p.history.forEach(h => { const hDate = new Date(h.date); if(hDate >= startDate && hDate <= endDate) { supplied += h.quantity; } }); }
            return { Nom: p.name || '', Reference: p.reference || '', Fournisseur: p.supplier || '', Quantite_Actuelle: p.quantity || 0, StockMin: p.minQuantity || 0, PrixUnitaire: p.unitPrice || 0, Valeur_Stock_Article: ((p.quantity || 0) * (p.unitPrice || 0)).toFixed(2), Quantite_Consommee_Periode: consumed, Quantite_Approvisionnee_Periode: supplied };
        });
        const totalStockValue = this.data.parts.reduce((total, part) => total + (Number(part.quantity) * Number(part.unitPrice || 0)), 0);
        const dataRows = [headers];
        data.forEach(item => { dataRows.push(headers.map(header => item[header])); });
        dataRows.push([]);
        dataRows.push(['', '', '', '', '', 'Valeur Totale du Stock', totalStockValue.toFixed(2)]);
        this.exportToCSV(dataRows, `rapport_stock_${new Date().toISOString().slice(0,10)}.csv`);
    },

    handleExportDowntime(last24Hours) {
        let interventionsToExport;
        let filename;
        if (last24Hours) {
            const now = new Date();
            const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            interventionsToExport = this.data.interventions.filter(i => {
                const iDate = new Date(i.date);
                return i.type === 'Corrective' && i.status === 'completed' && i.downtimeStart && i.downtimeEnd && iDate >= yesterday && iDate <= now;
            });
            filename = `export_pannes_24h_${now.toISOString().slice(0,10)}.csv`;
        } else {
            const filteredInterventions = this.getFilteredInterventions(this.dashboardFilters);
            interventionsToExport = filteredInterventions.filter(i => i.type === 'Corrective' && i.status === 'completed' && i.downtimeStart && i.downtimeEnd);
            filename = `export_pannes_${this.dashboardFilters.startDate}_au_${this.dashboardFilters.endDate}.csv`;
        }

        const headers = ['ID_Machine', 'Nom_Machine', 'Description_Panne', 'Date', 'Debut_Arret', 'Fin_Arret', 'Duree_Arret_Heures', 'Nom_Membre', 'Matricule_Membre'];
        let totalDowntimeHours = 0;
        const data = interventionsToExport.map(i => {
            const eq = this.data.equipments.find(e => e.id === i.eqId);
            const downtime = new Date(i.downtimeEnd) - new Date(i.downtimeStart);
            const downtimeHours = (downtime / (1000 * 60 * 60));
            totalDowntimeHours += downtimeHours;
            return { 
                ID_Machine: eq ? eq.uniqueId : 'N/A', 
                Nom_Machine: eq ? eq.name : 'Équipement supprimé', 
                Description_Panne: i.desc, Date: i.date, 
                Debut_Arret: i.downtimeStart.replace('T', ' '), 
                Fin_Arret: i.downtimeEnd.replace('T', ' '), 
                Duree_Arret_Heures: downtimeHours.toFixed(2),
                Nom_Membre: i.techName || 'N/A',
                Matricule_Membre: i.techMatricule || 'N/A'
            };
        });
        const dataRows = [headers];
        data.forEach(item => { dataRows.push(headers.map(header => item[header])); });
        dataRows.push([]);
        dataRows.push(['', '', '', '', '', '', 'Total Heures Arret', totalDowntimeHours.toFixed(2)]);
        this.exportToCSV(dataRows, filename);
    },

    showEquipmentDetails(id) { 
        const equipment = this.data.equipments.find(e => e.id === id); 
        if (!equipment) return; 
        document.getElementById('equipmentDetailModalTitle').textContent = `Détails pour ${equipment.name}`; 
        const contentEl = document.getElementById('equipmentDetailContent'); 
        contentEl.innerHTML = `<p><strong>ID:</strong> ${equipment.uniqueId || 'N/A'}</p>
                             <p><strong>N° de série:</strong> ${equipment.serialNumber || 'N/A'}</p>
                             <h4>Interventions sur cet équipement</h4>
                             <ul class="item-list" id="equip-interventions-list"></ul>`;
        const interventionsForEquipment = this.data.interventions.filter(i => i.eqId === id);
        document.getElementById('equip-interventions-list').innerHTML = interventionsForEquipment.length ? interventionsForEquipment.map(i => this.getItemTemplate('interventions', i)).join('') : '<p>Aucune intervention.</p>';
        this.openModal('equipmentDetailModal'); 
    },
    showPartDetails(id) { 
        const part = this.data.parts.find(p => p.id === id); if (!part) return; 
        document.getElementById('partDetailModalTitle').textContent = `Détails pour ${part.name}`; 
        const contentEl = document.getElementById('partDetailContent'); 
        contentEl.innerHTML = `<div class="date-filter-grid"><div class="form-group" style="margin:0;"><label>Début</label><input type="date" id="part-detail-start" class="form-control"></div><div class="form-group" style="margin:0;"><label>Fin</label><input type="date" id="part-detail-end" class="form-control"></div></div>
                             <div class="form-group" style="margin-top: 20px;"><label>Ajouter un approvisionnement</label><div style="display: flex; gap: 10px;"><input type="number" id="part-supply-qty" class="form-control" placeholder="Quantité" min="1"><input type="text" id="part-supply-po" class="form-control" placeholder="N° BC"><button id="add-supply-btn" class="btn"><i class="fas fa-plus"></i></button></div></div>
                             <h4 style="margin-top: 20px;">Historique des mouvements</h4><div id="part-detail-history"></div>`; 
        const calculateDetails = () => { 
            const startDate = document.getElementById('part-detail-start').value; 
            const endDate = document.getElementById('part-detail-end').value; 
            
            const consumptions = this.data.interventions.filter(i => { if (!i.partsUsed || !i.partsUsed[id] || i.status !== 'completed') return false; const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }).map(i => ({ date: i.date, memberId: i.techId, memberName: i.techName, memberMatricule: i.techMatricule, details: `OT: ${i.otNumber || 'N/A'}`, quantity: -i.partsUsed[id] })); 
            
            const supplies = (part.history || []).filter(h => { const hDate = new Date(h.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && hDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (hDate > end) return false; } return true; }).map(h => ({ ...h, details: `BC: ${h.poNumber}`, quantity: +h.quantity })); 

            const history = [...consumptions, ...supplies].sort((a,b) => new Date(b.date) - new Date(a.date)); 
            const historyEl = document.getElementById('part-detail-history'); 
            
            if (history.length === 0) { 
                historyEl.innerHTML = '<p>Aucun mouvement.</p>'; 
            } else { 
                let tableHTML = '<table class="detail-table"><tr><th>Date</th><th>Membre</th><th>Détails</th><th>Qté</th></tr>'; 
                history.forEach(h => { 
                    const member = this.data.members.find(m => m.id === h.memberId);
                    const memberIdentifier = member ? `${member.name} (${member.matricule})` : `${h.memberName} (${h.memberMatricule})`;
                    tableHTML += `<tr><td>${new Date(h.date).toLocaleDateString()}</td><td>${memberIdentifier}</td><td>${h.details}</td><td>${h.quantity > 0 ? '+' : ''}${h.quantity}</td></tr>`; }); 
                tableHTML += '</table>'; 
                historyEl.innerHTML = tableHTML; 
            } 
        }; 
        document.getElementById('add-supply-btn').addEventListener('click', async () => { 
            const qty = parseInt(document.getElementById('part-supply-qty').value, 10); 
            const poNumber = document.getElementById('part-supply-po').value; 
            if (qty > 0) { 
                const partRef = doc(db, `organizations/${this.currentUser.orgId}/parts`, id); 
                try { 
                    const partDoc = await getDoc(partRef); // Read before transaction for offline
                    if (partDoc.exists()) {
                        const newQuantity = Number(partDoc.data().quantity) + qty;
                        const newHistory = partDoc.data().history || [];
                        const memberProfile = this.data.members.find(m => m.id === this.currentUser.uid);
                        newHistory.push({ date: new Date().toISOString().slice(0, 10), memberId: this.currentUser.uid, memberName: `${memberProfile.name} ${memberProfile.surname}`, memberMatricule: memberProfile.matricule, poNumber: poNumber, quantity: qty });

                        const batch = writeBatch(db);
                        batch.update(partRef, { quantity: newQuantity, history: newHistory });
                        await batch.commit();
                    }
                    document.getElementById('part-supply-qty').value = '';
                    document.getElementById('part-supply-po').value = '';
                } catch (e) {
                    this.showAlert("Erreur lors de l'approvisionnement.");
                }
            }
        }); 
        document.getElementById('part-detail-start').onchange = calculateDetails; 
        document.getElementById('part-detail-end').onchange = calculateDetails; 
        calculateDetails(); 
        this.openModal('partDetailModal'); 
    }
};

