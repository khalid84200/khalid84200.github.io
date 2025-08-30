// Importations Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, getDoc, addDoc, setDoc, deleteDoc, writeBatch, runTransaction, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    signInAnonymously, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithRedirect, 
    getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

// Configuration Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBQCBlzr-RTDb99gF3sqhvbNIGXcf6OWEg",
    authDomain: "ma-gmao-ca6a5.firebaseapp.com",
    projectId: "ma-gmao-ca6a5",
    storageBucket: "ma-gmao-ca6a5.appspot.com",
    messagingSenderId: "279000639370",
    appId: "1:279000639370:web:6c04f86ba8dc82d097ca73"
};

// --- LOGIQUE DE DÉMARRAGE ROBUSTE ---

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// On attache l'observateur d'état d'authentification une seule fois.
// Il deviendra notre unique "source de vérité".
onAuthStateChanged(auth, (user) => {
    document.getElementById('loader').style.display = 'none';
    if (user) {
        GMAOApp.startAppWithUser(user);
    } else {
        GMAOApp.showLoginScreen();
    }
});

// En parallèle, on traite le résultat d'une éventuelle redirection.
// getRedirectResult est appelé à chaque chargement de page. S'il n'y a pas
// de redirection en cours, il ne fait rien. Sinon, il complète l'authentification.
getRedirectResult(auth).catch(error => {
    console.error("Erreur lors du traitement de la redirection :", error);
    GMAOApp.showAlert(`Erreur de connexion : ${error.message}`);
}).finally(() => {
    // Nettoyage de l'indicateur de session quoi qu'il arrive.
    sessionStorage.removeItem('pendingGoogleAuth');
});


enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') { console.warn("Conflit de versions Firestore détecté. La persistance sera désactivée pour cette session."); } 
    else if (err.code == 'unimplemented') { console.warn("Le navigateur ne supporte pas la persistance."); }
});

window.db = db;
window.auth = auth;
window.firebase = { collection, onSnapshot, doc, getDoc, addDoc, setDoc, deleteDoc, writeBatch, runTransaction, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, signInAnonymously, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult };

const GMAOApp = {
    data: { equipments: [], technicians: [], interventions: [], parts: [] },
    dashboardFilters: { startDate: null, endDate: null },
    stockReportFilters: { startDate: null, endDate: null },
    charts: {},
    currentUser: null,
    unsubscribeListeners: [],
    isAuthenticating: false, // Flag pour éviter les doubles authentifications
    
    startAppWithUser(user) {
        this.currentUser = user;
        this.isAuthenticating = false; // Réinitialiser le flag
        sessionStorage.removeItem('pendingGoogleAuth'); // Nettoyage final
        this.startApp();
    },

    showLoginScreen() {
        document.querySelector('.app-container').style.display = 'none';
        document.getElementById('auth-container').style.display = 'flex';
        this.unsubscribeListeners.forEach(unsub => unsub());
        this.unsubscribeListeners = [];
        this.isAuthenticating = false; // Réinitialiser le flag
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

    async handleGuestLogin() { try { await signInAnonymously(auth); } catch (error) { console.error("Erreur de connexion anonyme", error); this.showAlert("Impossible de démarrer le mode invité. Veuillez réessayer."); } },
    
    async handleGoogleLogin() {
        if (this.isAuthenticating) {
            console.log("Authentification déjà en cours...");
            return;
        }
        this.isAuthenticating = true;
        const provider = new GoogleAuthProvider();
    
        const performRedirect = () => {
            sessionStorage.setItem('pendingGoogleAuth', 'true');
            signInWithRedirect(auth, provider).catch(err => {
                 this.showAlert(`La redirection a échoué: ${err.message}`);
                 this.isAuthenticating = false; // Important: réinitialiser en cas d'échec
                 sessionStorage.removeItem('pendingGoogleAuth');
            });
        };
    
        // Stratégie universelle : essayer le popup d'abord, car c'est une meilleure UX.
        // Si le popup est bloqué ou fermé, utiliser la redirection comme plan B.
        try {
            await signInWithPopup(auth, provider);
            // Si on arrive ici, le popup a réussi. `onAuthStateChanged` sera déclenché.
            // isAuthenticating sera réinitialisé dans startAppWithUser.
        } catch (error) {
            // Gérer les erreurs de popup
            if (error.code === 'auth/popup-blocked' || 
                error.code === 'auth/cancelled-popup-request' ||
                error.code === 'auth/popup-closed-by-user') {
                
                // Le popup a échoué, on tente la redirection.
                console.log("Le popup a été bloqué ou fermé. Tentative avec une redirection.");
                performRedirect();
            } else {
                // Pour les autres erreurs (réseau, compte désactivé, etc.)
                console.error("Erreur de connexion popup Google :", error);
                this.showAlert(`Erreur de connexion : ${error.message}`);
                this.isAuthenticating = false;
            }
        }
    },

    async handleLogin(e) { e.preventDefault(); const email = document.getElementById('login-email').value; const password = document.getElementById('login-password').value; const errorMsg = document.getElementById('login-error-msg'); const button = e.target.querySelector('button'); button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; errorMsg.textContent = ''; try { await signInWithEmailAndPassword(auth, email, password); } catch (error) { errorMsg.textContent = "Email ou mot de passe incorrect."; button.disabled = false; button.textContent = 'Se connecter'; this.isAuthenticating = false; } },
    async handleSignup(e) { e.preventDefault(); const email = document.getElementById('signup-email').value; const password = document.getElementById('signup-password').value; const errorMsg = document.getElementById('signup-error-msg'); const button = e.target.querySelector('button'); button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; errorMsg.textContent = ''; try { await createUserWithEmailAndPassword(auth, email, password); } catch (error) { errorMsg.textContent = "Erreur : mot de passe trop court ou email invalide."; button.disabled = false; button.textContent = 'Créer un compte'; this.isAuthenticating = false; } },
    
    startApp() {
        document.getElementById('auth-container').style.display = 'none';
        document.querySelector('.app-container').style.display = 'block';
        this.applyTheme(localStorage.getItem('gmao-theme') || 'light');
        this.setupEventListeners();
        this.attachRealtimeListeners();
    },
    
    async attachRealtimeListeners() {
        if (!this.currentUser) return;

        const userMetaRef = doc(db, `users/${this.currentUser.uid}/metadata/status`);
        try {
            const userDoc = await getDoc(userMetaRef);
            if (!userDoc.exists()) {
                await this.addTestData(); 
                await setDoc(userMetaRef, { initialized: true });
            }
        } catch (e) {
            console.error("Erreur lors de la vérification/création des données utilisateur : ", e);
        }

        this.unsubscribeListeners.forEach(unsub => unsub());
        this.unsubscribeListeners = [];
        const collections = ['equipments', 'technicians', 'interventions', 'parts'];
        const basePath = `users/${this.currentUser.uid}`;
        collections.forEach(colName => {
            const unsub = onSnapshot(collection(db, basePath, colName), (snapshot) => {
                this.data[colName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                this.renderCurrentPage();
            }, (error) => {
                console.error(`Erreur d'écoute pour la collection ${colName}:`, error);
                this.showAlert("Erreur de connexion à la base de données. Veuillez vérifier vos règles de sécurité Firestore.");
            });
            this.unsubscribeListeners.push(unsub);
        });
        
        this.navigateTo(window.location.hash || '#dashboard');
    },
    
    showAlert(message, title = 'Information') {
        document.getElementById('custom-alert-title').textContent = title; document.getElementById('custom-alert-message').textContent = message;
        const modal = document.getElementById('custom-alert-modal'); const okButton = document.getElementById('custom-alert-ok');
        const closeHandler = () => { modal.classList.remove('active'); okButton.replaceWith(okButton.cloneNode(true)); };
        modal.classList.add('active');
        document.getElementById('custom-alert-ok').addEventListener('click', closeHandler, { once: true });
    },
    showConfirm(message, title = 'Confirmation') {
        return new Promise((resolve) => {
            document.getElementById('custom-confirm-title').textContent = title; document.getElementById('custom-confirm-message').textContent = message;
            const modal = document.getElementById('custom-confirm-modal'); const okButton = document.getElementById('custom-confirm-ok'); const cancelButton = document.getElementById('custom-confirm-cancel');
            const cleanupAndResolve = (value) => { modal.classList.remove('active'); okButton.replaceWith(okButton.cloneNode(true)); cancelButton.replaceWith(cancelButton.cloneNode(true)); resolve(value); };
            modal.classList.add('active');
            document.getElementById('custom-confirm-ok').addEventListener('click', () => cleanupAndResolve(true), { once: true });
            document.getElementById('custom-confirm-cancel').addEventListener('click', () => cleanupAndResolve(false), { once: true });
        });
    },

    async checkAuthAndPrompt() {
        if (this.currentUser && this.currentUser.isAnonymous) {
            this.openModal('auth-prompt-modal');
            document.getElementById('prompt-google-btn').onclick = () => { this.closeModal('auth-prompt-modal'); this.handleGoogleLogin(); };
            document.getElementById('prompt-email-btn').onclick = () => { this.closeModal('auth-prompt-modal'); signOut(auth); };
            return false;
        }
        return true;
    },

    renderCurrentPage() { const hash = window.location.hash || '#dashboard'; this.updateLowStockNotification(); this.updateButtonVisibility(hash); switch (hash) { case '#dashboard': this.renderDashboard(); break; case '#equipments': this.renderListPage('equipments'); break; case '#interventions': this.renderInterventionsPage(); break; case '#parts': this.renderPartsPage(); break; case '#technicians': this.renderListPage('technicians'); break; } },
    
    async handleSubmit(event) {
        event.preventDefault();
        const canProceed = await this.checkAuthAndPrompt();
        if (!canProceed) return;

        const form = event.target;
        const submitButton = form.querySelector('button[type="submit"]');
        if (!submitButton || submitButton.disabled) return;
        
        const type = form.dataset.type;
        const formData = new FormData(form);

        if (type === 'interventions') {
            const interventionType = formData.get('type');
            const interventionDateStr = formData.get('date');
            if (interventionType === 'Corrective' && interventionDateStr) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const interventionDate = new Date(interventionDateStr);
                if (interventionDate > today) {
                    this.showAlert("Une action corrective ne peut pas être planifiée dans le futur.");
                    return;
                }
            }
        }
        
        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';

        const id = formData.get('id');
        let itemData = Object.fromEntries(formData.entries());
        
        const newPartsUsed = {};
        if (type === 'interventions') {
            form.querySelectorAll('.used-part-item').forEach(item => {
                const partId = item.dataset.partId;
                const qtyInput = item.querySelector('input');
                const qty = parseInt(qtyInput.value, 10);
                if (qty > 0) { newPartsUsed[partId] = qty; }
            });
            itemData.partsUsed = newPartsUsed;
        }
        delete itemData.id;
        const path = `users/${this.currentUser.uid}/${type}`;

        try {
            if (type === 'parts' && !id && itemData.reference) { if (this.data.parts.find(p => p.reference && p.reference.toLowerCase() === itemData.reference.toLowerCase())) { this.showAlert("Erreur : Une pièce avec cette référence existe déjà."); throw new Error("Duplicate reference"); } }
            if (type === 'interventions') {
                await runTransaction(db, async (transaction) => {
                    const oldIntervention = id ? this.data.interventions.find(i => i.id === id) : null;
                    const oldPartsUsed = oldIntervention?.partsUsed || {};
                    const wasCompleted = oldIntervention?.status === 'completed';
                    const isNowCompleted = itemData.status === 'completed';
                    const allPartIds = new Set([...Object.keys(oldPartsUsed), ...Object.keys(newPartsUsed)]);
                    for (const partId of allPartIds) {
                        const oldQty = wasCompleted ? (oldPartsUsed[partId] || 0) : 0;
                        const newQty = isNowCompleted ? (newPartsUsed[partId] || 0) : 0;
                        const change = oldQty - newQty;
                        if (change !== 0) {
                            const partRef = doc(db, `users/${this.currentUser.uid}/parts`, partId);
                            const partDoc = await transaction.get(partRef);
                            if (partDoc.exists()) {
                                const currentQuantity = Number(partDoc.data().quantity);
                                if (currentQuantity + change < 0) { throw new Error(`Stock insuffisant pour ${partDoc.data().name}.`); }
                                transaction.update(partRef, { quantity: currentQuantity + change });
                            }
                        }
                    }
                    if (id) { transaction.set(doc(db, path, id), itemData, { merge: true }); }
                    else { itemData.otNumber = `OT-${Date.now()}`; transaction.set(doc(collection(db, path)), itemData); }
                });
            } else {
                if (id) { await setDoc(doc(db, path, id), itemData, { merge: true }); }
                else { await addDoc(collection(db, path), itemData); }
            }
            this.closeModal('formModal');
        } catch (e) {
            console.error("Erreur Firestore: ", e);
            this.showAlert(e.message || "Une erreur est survenue.");
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    },
    async deleteItem(type, id) { 
        const canProceed = await this.checkAuthAndPrompt();
        if (!canProceed) return;
        const confirmed = await this.showConfirm('Voulez-vous vraiment supprimer cet élément ?'); if (!confirmed) return; const path = `users/${this.currentUser.uid}/${type}/${id}`; try { await deleteDoc(doc(db, path)); this.closeModal('formModal'); } catch (e) { console.error("Erreur Firestore: ", e); this.showAlert("Une erreur est survenue."); } 
    },
    
    getFilteredInterventions(filters) { const { startDate, endDate } = filters; if (!startDate && !endDate) return this.data.interventions; return this.data.interventions.filter(i => { const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }); },
    
    renderDashboard() {
        const dateStartInput = document.getElementById('date-start'); const dateEndInput = document.getElementById('date-end');
        if (!this.dashboardFilters.startDate || !this.dashboardFilters.endDate) { const endDate = new Date(); const startDate = new Date(); startDate.setDate(endDate.getDate() - 30); this.dashboardFilters.startDate = startDate.toISOString().slice(0,10); this.dashboardFilters.endDate = endDate.toISOString().slice(0,10); }
        dateStartInput.value = this.dashboardFilters.startDate; dateEndInput.value = this.dashboardFilters.endDate;
        document.getElementById('filter-btn').addEventListener('click', () => { this.dashboardFilters.startDate = dateStartInput.value; this.dashboardFilters.endDate = dateEndInput.value; this.renderDashboard(); });
        if (this.currentUser && this.currentUser.isAnonymous) {
            document.getElementById('guest-info-card').style.display = 'block';
            document.getElementById('test-data-card').style.display = 'none';
        } else if (this.data.interventions.length === 0 && this.data.equipments.length === 0) {
            document.getElementById('guest-info-card').style.display = 'none';
            document.getElementById('test-data-card').style.display = 'block';
        } else {
            document.getElementById('guest-info-card').style.display = 'none';
            document.getElementById('test-data-card').style.display = 'none';
        }
        const filteredInterventions = this.getFilteredInterventions(this.dashboardFilters);
        const recentList = document.getElementById('recent-interventions-list');
        const sorted = [...this.data.interventions].sort((a,b) => new Date(b.date) - new Date(a.date));
        recentList.innerHTML = sorted.length ? sorted.slice(0, 5).map(item => this.getItemTemplate('interventions', item)).join('') : `<div class="loading-message">Aucune intervention récente.</div>`;
        this.calculateAndDisplayKPIs(filteredInterventions);
        this.renderAnalysisCharts(filteredInterventions);
        document.getElementById('export-downtime-btn').addEventListener('click', () => this.handleExportDowntime());
    },
    
    renderListPage(type) {
        const searchTerm = document.getElementById(`${type.slice(0, -1)}-search`).value;
        let listData = [...this.data[type]];
        if (type === 'interventions') {
            listData.sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        this.renderList(type, listData, searchTerm);
    },
    
    renderInterventionsPage() {
        ['intervention-date-start', 'intervention-date-end'].forEach(id => { document.getElementById(id).addEventListener('input', () => this.renderInterventionsPage()); });
        document.getElementById('intervention-search').addEventListener('input', () => this.renderInterventionsPage());
        const startDate = document.getElementById('intervention-date-start').value; const endDate = document.getElementById('intervention-date-end').value; const searchTerm = document.getElementById('intervention-search').value.toLowerCase();
        const filteredByDate = this.getFilteredInterventions({ startDate, endDate });
        const filteredBySearch = filteredByDate.filter(item => (item.desc.toLowerCase().includes(searchTerm)) || (item.otNumber && item.otNumber.toLowerCase().includes(searchTerm)));
        filteredBySearch.sort((a, b) => new Date(b.date) - new Date(a.date));
        this.renderList('interventions', filteredBySearch, '');
        const typeCounts = filteredByDate.reduce((acc, item) => { if (item.type) acc[item.type] = (acc[item.type] || 0) + 1; return acc; }, {});
        this.createChart('ratioChartCanvas', 'doughnut', { labels: Object.keys(typeCounts), datasets: [{ data: Object.values(typeCounts), backgroundColor: ['#4A90E2', '#F5A623', '#50E3C2'] }] }, { plugins: { legend: { position: 'top' } } });
    },
    
    renderPartsPage() {
        document.getElementById('export-stock-btn').addEventListener('click', () => this.handleExportStock());
        const dateStartInput = document.getElementById('stock-date-start');
        const dateEndInput = document.getElementById('stock-date-end');
        if (!dateStartInput.value || !dateEndInput.value) {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 30);
            dateStartInput.value = startDate.toISOString().slice(0, 10);
            dateEndInput.value = endDate.toISOString().slice(0, 10);
        }
        const supplierFilter = document.getElementById('supplier-filter'); const reorderFilter = document.getElementById('reorder-filter'); const searchInput = document.getElementById('part-search'); const totalStockValueEl = document.getElementById('total-stock-value');
        const suppliers = [...new Set(this.data.parts.map(p => p.supplier))].filter(Boolean); supplierFilter.innerHTML = `<option value="">Tous les fournisseurs</option>` + suppliers.map(s => `<option value="${s}">${s}</option>`).join('');
        const totalValue = this.data.parts.reduce((total, part) => total + (Number(part.quantity) * Number(part.unitPrice || 0)), 0); totalStockValueEl.textContent = `${totalValue.toFixed(2)} Dhs.`;
        const applyFilters = () => { const selectedSupplier = supplierFilter.value; const needsReorder = reorderFilter.checked; const searchTerm = searchInput.value.toLowerCase(); let filteredParts = this.data.parts; if (selectedSupplier) { filteredParts = filteredParts.filter(p => p.supplier === selectedSupplier); } if (needsReorder) { filteredParts = filteredParts.filter(p => Number(p.quantity) <= Number(p.minQuantity)); } if (searchTerm) { filteredParts = filteredParts.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.reference && p.reference.toLowerCase().includes(searchTerm))); } this.renderList('parts', filteredParts, ''); };
        supplierFilter.onchange = applyFilters; reorderFilter.onchange = applyFilters; searchInput.oninput = applyFilters; applyFilters();
    },
    
    renderList(type, data, searchTerm = '') { const listElement = document.getElementById(`${type}-list`); if (!listElement) return; const filteredData = searchTerm ? data.filter(item => (item.name && item.name.toLowerCase().includes(searchTerm)) || (item.desc && item.desc.toLowerCase().includes(searchTerm)) || (item.reference && item.reference.toLowerCase().includes(searchTerm)) || (item.otNumber && item.otNumber.toLowerCase().includes(searchTerm))) : data; listElement.innerHTML = filteredData.length > 0 ? filteredData.map(item => this.getItemTemplate(type, item)).join('') : `<div class="loading-message">Aucun élément trouvé.</div>`; },
    
    getItemTemplate(type, item) {
        let icon, title, subtitle, actions = '', details = '', clickableClass = 'list-item-clickable';
        switch (type) {
            case 'equipments': icon = `<div class="item-icon bg-blue"><i class="fas fa-cogs"></i></div>`; title = item.uniqueId ? `${item.uniqueId} - ${item.name}` : item.name; subtitle = `N/S: ${item.serialNumber || 'N/A'}`; actions = `<i class="fas fa-edit action-icon" data-action="edit"></i><i class="fas fa-qrcode action-icon" data-action="qr"></i>`; break;
            case 'interventions': const eq = this.data.equipments.find(e => e.id === item.eqId); icon = `<div class="item-icon bg-orange"><i class="fas fa-wrench"></i></div>`; title = `${item.otNumber || ''}: ${item.desc}`; subtitle = `${eq ? eq.uniqueId || eq.name : 'Équipement supprimé'} - ${item.date ? new Date(item.date).toLocaleDateString() : ''}`; const statusClasses = { planned: 'status-planned', progress: 'status-progress', completed: 'status-completed' }; actions = `<span class="status-badge ${statusClasses[item.status]}">${item.status}</span>`; if (item.downtimeStart && item.downtimeEnd) details = `<div class="item-details"><span class="detail-badge"><i class="fas fa-clock"></i> ${this.formatDuration(new Date(item.downtimeEnd) - new Date(item.downtimeStart))}</span></div>`; break;
            case 'parts': icon = `<div class="item-icon bg-grey"><i class="fas fa-box"></i></div>`; title = item.name; subtitle = `Réf: ${item.reference || 'N/A'}`; const stock = Number(item.quantity); const minStock = Number(item.minQuantity); const stockClass = stock <= minStock ? 'status-low-stock' : 'status-planned'; actions = `<div class="item-actions"><span class="status-badge status-info">Fourn: ${item.supplier || '--'}</span><span class="status-badge status-info">Délai: ${item.delaiLivraison || '--'}j</span><span class="status-badge status-info">Min: ${minStock}</span><span class="status-badge ${stockClass}">Stock: ${stock}</span><i class="fas fa-edit action-icon" data-action="edit"></i></div>`; break;
            case 'technicians': icon = `<div class="item-icon bg-green"><i class="fas fa-user-cog"></i></div>`; title = item.name; subtitle = item.specialty; actions = `<i class="fas fa-edit action-icon" data-action="edit"></i>`; break;
        }
        return `<li class="list-item ${clickableClass}" data-type="${type}" data-id="${item.id}">${icon}<div class="item-info"><div class="item-title">${title}</div><div class="item-subtitle">${subtitle}</div>${details}</div><div class="item-actions">${actions}</div></li>`;
    },
    
    calculateAndDisplayKPIs(interventions) {
        const { startDate, endDate } = this.dashboardFilters;
        const correctiveCompleted = interventions.filter(i => i.type === 'Corrective' && i.status === 'completed' && i.downtimeStart && i.downtimeEnd);
        const totalDowntime = correctiveCompleted.reduce((acc, i) => acc + (new Date(i.downtimeEnd) - new Date(i.downtimeStart)), 0);
        let availability = 100.0;
        if (startDate && endDate) { const totalPeriod = new Date(endDate) - new Date(startDate); if (totalPeriod > 0) { const uptime = Math.max(0, totalPeriod - totalDowntime); availability = (uptime / totalPeriod) * 100; } }
        document.getElementById('kpi-availability-value').textContent = `${availability.toFixed(1)}%`;
        this.createChart('availabilityChart', 'doughnut', { datasets: [{ data: [availability, 100 - availability], backgroundColor: [getComputedStyle(document.documentElement).getPropertyValue('--secondary-color'), getComputedStyle(document.documentElement).getPropertyValue('--border-color')], borderWidth: 0, cutout: '70%' }] }, { plugins: { tooltip: { enabled: false } } });
        const mttr = correctiveCompleted.length > 0 ? totalDowntime / correctiveCompleted.length : 0;
        document.getElementById('kpi-mttr').textContent = this.formatDuration(mttr);
        let mtbf = 0;
        if (correctiveCompleted.length > 1) {
            const sorted = correctiveCompleted.sort((a, b) => new Date(a.downtimeStart) - new Date(b.downtimeStart));
            let totalUptimeForMtbf = 0;
            for (let i = 1; i < sorted.length; i++) { const uptime = new Date(sorted[i].downtimeStart) - new Date(sorted[i - 1].downtimeEnd); if (uptime > 0) totalUptimeForMtbf += uptime; }
            mtbf = totalUptimeForMtbf / (sorted.length - 1);
        }
        document.getElementById('kpi-mtbf').textContent = this.formatDuration(mtbf, true);
    },
    
    renderAnalysisCharts(allFilteredInterventions) {
        const msToHours = ms => ms / 3600000;
        const interventionsWithDowntime = allFilteredInterventions.filter(i => i.status === 'completed' && i.downtimeStart && i.downtimeEnd);
        const downtimeByEquipment = interventionsWithDowntime.reduce((acc, i) => { const downtime = new Date(i.downtimeEnd) - new Date(i.downtimeStart); acc[i.eqId] = (acc[i.eqId] || 0) + downtime; return acc; }, {});
        const sortedEquipment = Object.entries(downtimeByEquipment).sort(([, a], [, b]) => b - a).slice(0, 3);
        const eqLabels = sortedEquipment.map(([id]) => this.data.equipments.find(e => e.id === id)?.name || 'N/A');
        const eqData = sortedEquipment.map(([, downtime]) => msToHours(downtime));
        this.createChart('downtimeByEquipmentChart', 'bar', { labels: eqLabels, datasets: [{ label: "Heures d'arrêt", data: eqData, backgroundColor: '#D0021B' }] }, { indexAxis: 'y', plugins: { legend: { display: false } } });
    },
    
    createChart(canvasId, type, data, options = {}) { if(!document.getElementById(canvasId)) return; if (this.charts[canvasId]) this.charts[canvasId].destroy(); const ctx = document.getElementById(canvasId).getContext('2d'); this.charts[canvasId] = new Chart(ctx, { type, data, options: { responsive: true, ...options } }); },
    navigateTo(hash) { const newHash = hash || '#dashboard'; document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active')); document.querySelector(newHash).classList.add('active'); document.querySelectorAll('.nav-item').forEach(n => { n.classList.toggle('active', n.getAttribute('href') === newHash); }); window.location.hash = newHash; this.renderCurrentPage(); },
    updateButtonVisibility(hash) { const fab = document.getElementById('fab-add-button'); const whatsappBtn = document.getElementById('whatsapp-btn'); if (hash === '#dashboard' || hash === '') { fab.style.display = 'none'; whatsappBtn.style.display = 'inline-flex'; } else { fab.style.display = 'flex'; whatsappBtn.style.display = 'none'; } },
    openModal(modalId) { document.getElementById(modalId).classList.add('active'); },
    closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); },
    
    openForm(type, id = null) {
        const form = document.getElementById('mainForm'); const modalTitle = document.getElementById('modalTitle'); let html = '', title = '', item = null; const eqOptions = this.data.equipments.map(e => `<option value="${e.id}">${e.uniqueId || e.name}</option>`).join(''); const techOptions = this.data.technicians.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        switch (type) {
            case 'interventions': item = id ? this.data.interventions.find(i => i.id === id) : {}; title = id ? 'Modifier Intervention' : 'Nouvelle Intervention'; html = `<input type="hidden" name="id" value="${item.id || ''}"><div class="form-group"><label>Description</label><input type="text" name="desc" class.form-control" value="${item.desc || ''}" required></div><div class="form-group"><label>Date</label><input type="date" name="date" class="form-control" value="${item.date || new Date().toISOString().slice(0,10)}" required></div><div class="form-group"><label>Type</label><select name="type" class="form-control"><option value="Préventive">Préventive</option><option value="Corrective">Corrective</option></select></div><div class="form-group"><label>Statut</label><select name="status" class="form-control"><option value="planned">planned</option><option value="progress">progress</option><option value="completed">completed</option></select></div><div class="form-group"><label>Équipement</label><select name="eqId" class="form-control">${eqOptions}</select></div><div class="form-group"><label>Technicien</label><select name="techId" class="form-control">${techOptions}</select></div><div class="form-group"><label>Pièces utilisées</label><div id="used-parts-container"></div><input type="text" id="part-search-input" class="form-control" placeholder="Rechercher une pièce..."><div class="parts-search-results" id="parts-search-results"></div></div><hr style="border: 1px solid var(--border-color); margin: 20px 0;"><div class="form-group"><label>Début intervention</label><input type="datetime-local" name="downtimeStart" class="form-control" value="${item.downtimeStart || ''}"></div><div class="form-group"><label>Fin intervention</label><input type="datetime-local" name="downtimeEnd" class="form-control" value="${item.downtimeEnd || ''}"></div>`; break;
            case 'parts': item = id ? this.data.parts.find(p => p.id === id) : {}; title = id ? 'Modifier Pièce' : 'Nouvelle Pièce'; html = `<input type="hidden" name="id" value="${item.id || ''}"><div class="form-group"><label>Nom</label><input type="text" name="name" class="form-control" value="${item.name || ''}" required></div><div class="form-group"><label>Référence</label><input type="text" name="reference" class="form-control" value="${item.reference || ''}"></div><div class="form-group"><label>Fournisseur</label><input type="text" name="supplier" class="form-control" value="${item.supplier || ''}"></div><div class="form-group"><label>Prix Unitaire (HT)</label><input type="number" step="0.01" name="unitPrice" class="form-control" value="${item.unitPrice || 0}"></div><div class="form-group"><label>Quantité</label><input type="number" name="quantity" class="form-control" value="${item.quantity || 0}" required ${id ? 'readonly' : ''}></div><div class="form-group"><label>Quantité Minimum</label><input type="number" name="minQuantity" class="form-control" value="${item.minQuantity || 0}" required></div><div class="form-group"><label>Délai Livraison (jours)</label><input type="number" name="delaiLivraison" class="form-control" value="${item.delaiLivraison || 0}"></div>`; break;
            case 'equipments': item = id ? this.data.equipments.find(e => e.id === id) : {}; title = id ? 'Modifier Équipement' : 'Nouvel Équipement'; html = `<input type="hidden" name="id" value="${item.id || ''}"><div class="form-group"><label>Nom</label><input type="text" name="name" class="form-control" value="${item.name || ''}" required></div><div class="form-group"><label>Identifiant (ID)</label><input type="text" name="uniqueId" class="form-control" value="${item.uniqueId || ''}" required></div><div class="form-group"><label>Numéro de Série</label><input type="text" name="serialNumber" class="form-control" value="${item.serialNumber || ''}"></div><div class="form-group"><label>Localisation</label><input type="text" name="location" class="form-control" value="${item.location || ''}"></div>`; break;
            default: const typeLabels = { technicians: 'Technicien' }; title = id ? `Modifier ${typeLabels[type]}` : `Nouveau ${typeLabels[type]}`; item = id ? this.data[type].find(e => e.id === id) : {}; const fields = { technicians: [{label: 'Nom', name: 'name'}, {label: 'Spécialité', name: 'specialty'}] }; html = `<input type="hidden" name="id" value="${item.id || ''}">`; fields[type].forEach(field => { html += `<div class="form-group"><label>${field.label}</label><input type="text" name="${field.name}" class="form-control" value="${item[field.name] || ''}" required></div>`; }); break;
        }
        form.innerHTML = html + `<button type="submit" class="btn btn-full">Enregistrer</button>${id ? `<button type="button" id="form-delete-btn" class="btn btn-full btn-danger" style="margin-top:10px;">Supprimer</button>` : ''}`;
        if(id){ Object.keys(item).forEach(key => { if(form.elements[key]) form.elements[key].value = item[key]; }); if (type === 'interventions' && item.partsUsed) { this.prefillUsedParts(item.partsUsed); } }
        if (type === 'interventions') this.setupPartSearch();
        
        if (id) {
            document.getElementById('form-delete-btn').addEventListener('click', () => this.deleteItem(type, id));
        }

        modalTitle.textContent = title; form.dataset.type = type; this.openModal('formModal');
    },

    showTechnicianStats(id) { const technicien = this.data.technicians.find(t => t.id === id); if (!technicien) return; const interventionsFiltrees = this.getFilteredInterventions(this.dashboardFilters); const techInterventions = interventionsFiltrees.filter(i => i.techId === id && i.status === 'completed' && i.downtimeStart && i.downtimeEnd); const totalWorkTime = techInterventions.reduce((acc, i) => acc + (new Date(i.downtimeEnd) - new Date(i.downtimeStart)), 0); const uniqueWorkDays = new Set(techInterventions.map(i => i.date)).size; const workdayInMillis = (8 * 60 - 45) * 60 * 1000; const totalWorkableTime = uniqueWorkDays * workdayInMillis; const workloadPercentage = totalWorkableTime > 0 ? (totalWorkTime / totalWorkableTime) * 100 : 0; document.getElementById('statsModalTitle').textContent = `Stats de ${technicien.name}`; document.getElementById('statsTotalTime').textContent = this.formatDuration(totalWorkTime, true); document.getElementById('statsWorkload').textContent = `${workloadPercentage.toFixed(1)}%`; this.openModal('statsModal'); },
    showEquipmentDetails(id) { const equipment = this.data.equipments.find(e => e.id === id); if (!equipment) return; document.getElementById('equipmentDetailModalTitle').textContent = `Détails pour ${equipment.name}`; const contentEl = document.getElementById('equipmentDetailContent'); contentEl.innerHTML = `<div class="date-filter-grid"><div class="form-group" style="margin:0;"><label>Début</label><input type="date" id="equip-detail-start" class="form-control"></div><div class="form-group" style="margin:0;"><label>Fin</label><input type="date" id="equip-detail-end" class="form-control"></div></div><h4 style="margin-top: 20px;">Temps d'arrêt total</h4><p id="equip-detail-downtime">--</p><h4 style="margin-top: 20px;">Pièces consommées</h4><div id="equip-detail-parts"></div>`; const calculateDetails = () => { const startDate = document.getElementById('equip-detail-start').value; const endDate = document.getElementById('equip-detail-end').value; const relevantInterventions = this.data.interventions.filter(i => { if (i.eqId !== id || i.status !== 'completed') return false; const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }); const totalDowntime = relevantInterventions.reduce((total, i) => { if (i.downtimeStart && i.downtimeEnd) { return total + (new Date(i.downtimeEnd) - new Date(i.downtimeStart)); } return total; }, 0); document.getElementById('equip-detail-downtime').textContent = this.formatDuration(totalDowntime, true); const partsListEl = document.getElementById('equip-detail-parts'); let tableHTML = '<table class="detail-table"><tr><th>Date</th><th>OT</th><th>Pièce</th><th>Qté</th></tr>'; let partsFound = false; relevantInterventions.forEach(i => { if(i.partsUsed && Object.keys(i.partsUsed).length > 0) { partsFound = true; for (const partId in i.partsUsed) { const part = this.data.parts.find(p => p.id === partId); tableHTML += `<tr><td>${new Date(i.date).toLocaleDateString()}</td><td>${i.otNumber || '--'}</td><td>${part ? part.name : 'N/A'}</td><td>${i.partsUsed[partId]}</td></tr>`; } } }); tableHTML += '</table>'; partsListEl.innerHTML = partsFound ? tableHTML : '<p>Aucune pièce consommée.</p>'; }; document.getElementById('equip-detail-start').onchange = calculateDetails; document.getElementById('equip-detail-end').onchange = calculateDetails; calculateDetails(); this.openModal('equipmentDetailModal'); },
    showPartDetails(id) { const part = this.data.parts.find(p => p.id === id); if (!part) return; document.getElementById('partDetailModalTitle').textContent = `Détails pour ${part.name}`; const contentEl = document.getElementById('partDetailContent'); contentEl.innerHTML = `<div class="date-filter-grid"><div class="form-group" style="margin:0;"><label>Début</label><input type="date" id="part-detail-start" class="form-control"></div><div class="form-group" style="margin:0;"><label>Fin</label><input type="date" id="part-detail-end" class="form-control"></div></div><div class="form-group" style="margin-top: 20px;"><label>Ajouter un approvisionnement</label><div style="display: flex; gap: 10px;"><input type="number" id="part-supply-qty" class="form-control" placeholder="Quantité"><input type="text" id="part-supply-po" class="form-control" placeholder="N° BC"><button id="add-supply-btn" class="btn"><i class="fas fa-plus"></i></button></div></div><h4 style="margin-top: 20px;">Historique des mouvements</h4><div id="part-detail-history"></div>`; const calculateDetails = () => { const startDate = document.getElementById('part-detail-start').value; const endDate = document.getElementById('part-detail-end').value; const consumptions = this.data.interventions.filter(i => { if (!i.partsUsed || !i.partsUsed[id] || i.status !== 'completed') return false; const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }).map(i => ({ date: i.date, type: 'Consommation', quantity: `-${i.partsUsed[id]}`, details: `${i.otNumber || 'N/A'} sur ${this.data.equipments.find(e => e.id === i.eqId)?.name || 'N/A'}` })); const supplies = (part.history || []).filter(h => { if (h.type !== 'approvisionnement') return false; const hDate = new Date(h.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && hDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (hDate > end) return false; } return true; }).map(h => ({ ...h, quantity: `+${h.quantity}` })); const history = [...consumptions, ...supplies].sort((a,b) => new Date(b.date) - new Date(a.date)); const historyEl = document.getElementById('part-detail-history'); if (history.length === 0) { historyEl.innerHTML = '<p>Aucun mouvement.</p>'; } else { let tableHTML = '<table class="detail-table"><tr><th>Date</th><th>Type</th><th>Détails</th><th>Qté</th></tr>'; history.forEach(h => { tableHTML += `<tr><td>${new Date(h.date).toLocaleDateString()}</td><td>${h.type}</td><td>${h.details}</td><td>${h.quantity}</td></tr>`; }); tableHTML += '</table>'; historyEl.innerHTML = tableHTML; } }; document.getElementById('add-supply-btn').addEventListener('click', async () => { const qty = parseInt(document.getElementById('part-supply-qty').value, 10); const poNumber = document.getElementById('part-supply-po').value; if (qty > 0) { const partRef = doc(db, `users/${this.currentUser.uid}/parts`, id); try { await runTransaction(db, async (transaction) => { const partDoc = await transaction.get(partRef); if (partDoc.exists()) { const newQuantity = Number(partDoc.data().quantity) + qty; const newHistory = partDoc.data().history || []; newHistory.push({ date: new Date().toISOString().slice(0,10), type: 'approvisionnement', quantity: qty, details: `BC: ${poNumber}` }); transaction.update(partRef, { quantity: newQuantity, history: newHistory }); } }); document.getElementById('part-supply-qty').value = ''; document.getElementById('part-supply-po').value = ''; } catch (e) { this.showAlert("Erreur."); } } }); document.getElementById('part-detail-start').onchange = calculateDetails; document.getElementById('part-detail-end').onchange = calculateDetails; calculateDetails(); this.openModal('partDetailModal'); },
    closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); },
    showQRCode(id) { const eq = this.data.equipments.find(e => e.id === id); if(!eq) return; const qrContainer = document.getElementById('qrCodeCanvas'); qrContainer.innerHTML = ''; document.getElementById('qrEquipmentName').textContent = eq.name; new QRCode(qrContainer, { text: `gmao://equipment/${eq.id}`, width: 200, height: 200 }); this.openModal('qrModal'); },
    toggleTheme() { const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark'; this.applyTheme(newTheme); localStorage.setItem('gmao-theme', newTheme); },
    applyTheme(theme) { const icon = document.querySelector('.theme-switcher'); if (theme === 'dark') { document.body.classList.add('dark-mode'); icon.classList.replace('fa-moon', 'fa-sun'); } else { document.body.classList.remove('dark-mode'); icon.classList.replace('fa-sun', 'fa-moon'); } },
    formatDuration(ms, long = false) { if (ms <= 0 || !ms) return long ? "0j 0h 0m" : "0m"; const days = Math.floor(ms / 86400000); const hours = Math.floor((ms % 86400000) / 3600000); const minutes = Math.floor((ms % 3600000) / 60000); if (long) return `${days}j ${hours}h ${minutes}m`; let result = ''; if (days > 0) result += `${days}j `; if (hours > 0) result += `${hours}h `; result += `${minutes}m`; return result.trim() || "0m"; },
    
    setupEventListeners() {
        if (this.eventListenersAttached) return;
        document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
        document.getElementById('whatsapp-btn').addEventListener('click', () => this.openModal('whatsappModal'));
        window.addEventListener('hashchange', () => this.navigateTo(window.location.hash));
        document.querySelector('.bottom-nav').addEventListener('click', e => { const navItem = e.target.closest('.nav-item'); if (navItem) { e.preventDefault(); this.navigateTo(navItem.getAttribute('href')); } });
        document.getElementById('fab-add-button').addEventListener('click', async () => { 
            const canProceed = await this.checkAuthAndPrompt();
            if (!canProceed) return;
            const page = (window.location.hash || '#dashboard').substring(1); 
            if (page !== 'dashboard' && page !== '') this.openForm(page); 
        });
        document.querySelectorAll('.modal').forEach(modal => { modal.addEventListener('click', e => { if (e.target === modal || e.target.classList.contains('close-modal')) this.closeModal(modal.id); }); });
        document.getElementById('mainForm').addEventListener('submit', (e) => this.handleSubmit(e));
        document.querySelector('.theme-switcher').addEventListener('click', () => this.toggleTheme());
        document.getElementById('add-test-data-btn').addEventListener('click', () => this.addTestData(), { once: true });
        
        document.querySelector('.app-container').addEventListener('click', e => {
            const listItem = e.target.closest('.list-item-clickable');
            if (!listItem) return;

            const actionIcon = e.target.closest('.action-icon');
            const type = listItem.dataset.type;
            const id = listItem.dataset.id;

            if (actionIcon) {
                e.stopPropagation(); 
                const action = actionIcon.dataset.action;
                if (action === 'edit') { this.openForm(type, id); } 
                else if (action === 'qr') { this.showQRCode(id); }
            } else {
                switch(type) {
                    case 'technicians': this.showTechnicianStats(id); break;
                    case 'equipments': this.showEquipmentDetails(id); break;
                    case 'parts': this.showPartDetails(id); break;
                    case 'interventions': this.openForm(type, id); break;
                }
            }
        });
        this.eventListenersAttached = true;
    },
    
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
            if(p.history) { p.history.forEach(h => { const hDate = new Date(h.date); if(h.type === 'approvisionnement' && hDate >= startDate && hDate <= endDate) { supplied += h.quantity; } }); }
            return { Nom: p.name || '', Reference: p.reference || '', Fournisseur: p.supplier || '', Quantite_Actuelle: p.quantity || 0, StockMin: p.minQuantity || 0, PrixUnitaire: p.unitPrice || 0, Valeur_Stock_Article: ((p.quantity || 0) * (p.unitPrice || 0)).toFixed(2), Quantite_Consommee_Periode: consumed, Quantite_Approvisionnee_Periode: supplied };
        });
        const totalStockValue = this.data.parts.reduce((total, part) => total + (Number(part.quantity) * Number(part.unitPrice || 0)), 0);
        const dataRows = [headers];
        data.forEach(item => { dataRows.push(headers.map(header => item[header])); });
        dataRows.push([]);
        dataRows.push(['', '', '', '', '', 'Valeur Totale du Stock', totalStockValue.toFixed(2)]);
        this.exportToCSV(dataRows, 'rapport_stock.csv');
    },

    handleExportDowntime() {
        const filteredInterventions = this.getFilteredInterventions(this.dashboardFilters);
        const correctiveCompleted = filteredInterventions.filter(i => i.type === 'Corrective' && i.status === 'completed' && i.downtimeStart && i.downtimeEnd);
        const headers = ['ID_Machine', 'Nom_Machine', 'Description_Panne', 'Date', 'Debut_Arret', 'Fin_Arret', 'Duree_Arret_Heures'];
        let totalDowntimeHours = 0;
        const data = correctiveCompleted.map(i => {
            const eq = this.data.equipments.find(e => e.id === i.eqId);
            const downtime = new Date(i.downtimeEnd) - new Date(i.downtimeStart);
            const downtimeHours = (downtime / (1000 * 60 * 60));
            totalDowntimeHours += downtimeHours;
            return { ID_Machine: eq ? eq.uniqueId : 'N/A', Nom_Machine: eq ? eq.name : 'Équipement supprimé', Description_Panne: i.desc, Date: i.date, Debut_Arret: i.downtimeStart.replace('T', ' '), Fin_Arret: i.downtimeEnd.replace('T', ' '), Duree_Arret_Heures: downtimeHours.toFixed(2) };
        });
        const dataRows = [headers];
        data.forEach(item => { dataRows.push(headers.map(header => item[header])); });
        dataRows.push([]);
        dataRows.push(['', '', '', '', '', 'Total Heures Arret', totalDowntimeHours.toFixed(2)]);
        this.exportToCSV(dataRows, `export_pannes_${this.dashboardFilters.startDate}_au_${this.dashboardFilters.endDate}.csv`);
    },
    
    setupPartSearch() {
        const searchInput = document.getElementById('part-search-input'); const searchResults = document.getElementById('parts-search-results');
        searchInput.addEventListener('input', () => { const term = searchInput.value.toLowerCase(); if (term.length < 2) { searchResults.innerHTML = ''; return; } const results = this.data.parts.filter(p => p.name.toLowerCase().includes(term) || (p.reference && p.reference.toLowerCase().includes(term))); searchResults.innerHTML = results.map(p => `<div data-part-id="${p.id}">${p.name} - Réf: ${p.reference || 'N/A'}</div>`).join(''); });
        searchResults.addEventListener('click', e => { if (e.target.dataset.partId) { const partId = e.target.dataset.partId; const part = this.data.parts.find(p => p.id === partId); this.addPartToUsedList(part); searchInput.value = ''; searchResults.innerHTML = ''; } });
    },
    addPartToUsedList(part, quantity = 1) { const container = document.getElementById('used-parts-container'); if (container.querySelector(`[data-part-id="${part.id}"]`)) return; const item = document.createElement('div'); item.className = 'used-part-item'; item.dataset.partId = part.id; item.innerHTML = `<span>${part.name}</span><input type="number" class="form-control" value="${quantity}" min="1"><button type="button" class="remove-part-btn"><i class="fas fa-times-circle"></i></button>`; item.querySelector('.remove-part-btn').addEventListener('click', () => item.remove()); container.appendChild(item); },
    prefillUsedParts(partsUsed) { if (!partsUsed) return; for (const partId in partsUsed) { const part = this.data.parts.find(p => p.id === partId); if (part) { this.addPartToUsedList(part, partsUsed[partId]); } } },
    updateLowStockNotification() { const needsReorder = this.data.parts.some(p => Number(p.quantity) <= Number(p.minQuantity)); document.querySelector('.nav-item[href="#parts"] .notification-dot').style.display = needsReorder ? 'block' : 'none'; },
    
    async addTestData() {
        if (!this.currentUser) return;
        const btn = document.getElementById('add-test-data-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ajout en cours...';
        }

        const batch = writeBatch(db); const basePath = `users/${this.currentUser.uid}`;
        const eq1 = doc(collection(db, basePath, "equipments")); const eq2 = doc(collection(db, basePath, "equipments")); const eq3 = doc(collection(db, basePath, "equipments")); const eq4 = doc(collection(db, basePath, "equipments")); const eq5 = doc(collection(db, basePath, "equipments"));
        const tech1 = doc(collection(db, basePath, "technicians")); const tech2 = doc(collection(db, basePath, "technicians")); const tech3 = doc(collection(db, basePath, "technicians"));
        const testData = {
            equipments: [ { id: eq1.id, name: "Presse Hydraulique P1", uniqueId: "PRE-001", serialNumber: "SN-A1B2", location: "Atelier A" }, { id: eq2.id, name: "Robot de soudure R2", uniqueId: "ROB-002", serialNumber: "SN-C3D4", location: "Ligne 3" }, { id: eq3.id, name: "Compresseur d'air C-500", uniqueId: "COMP-001", serialNumber: "SN-E5F6", location: "Salle machines" }, { id: eq4.id, name: "Pont Roulant PR-01", uniqueId: "PONT-001", serialNumber: "SN-G7H8", location: "Expédition" }, { id: eq5.id, name: "Four thermique FTT-8", uniqueId: "FOUR-001", serialNumber: "SN-I9J0", location: "Atelier B" } ],
            technicians: [ { id: tech1.id, name: "Jean Dupont", specialty: "Mécanique" }, { id: tech2.id, name: "Amina El Fassi", specialty: "Électronique" }, { id: tech3.id, name: "Marc Petit", specialty: "Hydraulique" } ],
            parts: [ { name: "Filtre à huile H-123", reference: "F-5540", supplier: "Fournisseur A", quantity: 12, minQuantity: 5, delaiLivraison: 3, unitPrice: 150.50, history: [{date: "2025-08-10", type: "approvisionnement", quantity: 10, details: "BC-123"}] }, { name: "Roulement 6204-2RS", reference: "R-6204", supplier: "Fournisseur B", quantity: 3, minQuantity: 4, delaiLivraison: 7, unitPrice: 80 }, { name: "Sonde de température PT100", reference: "S-PT100", supplier: "Fournisseur C", quantity: 8, minQuantity: 3, delaiLivraison: 5, unitPrice: 350 } ],
            interventions: [
                { eqId: eq1.id, techId: tech3.id, desc: "Surchauffe hydraulique", type: "Corrective", date: "2025-08-22", status: "completed", downtimeStart: "2025-08-22T14:00", downtimeEnd: "2025-08-22T18:00", partsUsed: {} },
                { eqId: eq3.id, techId: tech1.id, desc: "Fuite d'air importante", type: "Corrective", date: "2025-08-18", status: "completed", downtimeStart: "2025-08-18T10:00", downtimeEnd: "2025-08-18T15:00", partsUsed: {} },
                { eqId: eq5.id, techId: tech2.id, desc: "Sonde température HS", type: "Corrective", date: "2025-08-15", status: "completed", downtimeStart: "2025-08-15T08:00", downtimeEnd: "2025-08-15T11:00", partsUsed: {} },
                { eqId: eq2.id, techId: tech2.id, desc: "Problème de pince", type: "Corrective", date: "2025-08-20", status: "completed", downtimeStart: "2025-08-20T09:00", downtimeEnd: "2025-08-20T11:00", partsUsed: {} },
                { eqId: eq4.id, techId: tech1.id, desc: "Graissage annuel", type: "Préventive", date: "2025-08-25", status: "planned" }
            ]
        };
        try {
            testData.equipments.forEach(item => batch.set(doc(db, basePath, "equipments", item.id), item));
            testData.technicians.forEach(item => batch.set(doc(db, basePath, "technicians", item.id), item));
            testData.parts.forEach(item => batch.set(doc(collection(db, basePath, "parts")), item));
            testData.interventions.forEach(item => batch.set(doc(collection(db, basePath, "interventions")), item));
            await batch.commit();
            if(!this.currentUser.isAnonymous) {
                this.showAlert("Données de test ajoutées avec succès !");
            }
        } catch (e) { console.error("Erreur ajout données: ", e); if(!this.currentUser.isAnonymous){this.showAlert("Erreur lors de l'ajout des données.");} }
    }
};
