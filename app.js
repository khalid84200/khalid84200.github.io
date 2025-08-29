// Importations Firebase (au début du fichier JS)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, addDoc, setDoc, deleteDoc, writeBatch, runTransaction } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";

// Configuration Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBQCBlzr-RTDb99gF3sqhvbNIGXcf6OWEg",
    authDomain: "ma-gmao-ca6a5.firebaseapp.com",
    projectId: "ma-gmao-ca6a5",
    storageBucket: "ma-gmao-ca6a5.appspot.com",
    messagingSenderId: "279000639370",
    appId: "1:279000639370:web:6c04f86ba8dc82d097ca73"
};

// Initialisation de Firebase et exposition des fonctions
window.db = getFirestore(initializeApp(firebaseConfig));
window.auth = getAuth();
window.firebase = {
    collection, onSnapshot, doc, addDoc, setDoc, deleteDoc, writeBatch, runTransaction,
    onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
};

// Logique de l'application GMAO
const GMAOApp = {
    data: { equipments: [], technicians: [], interventions: [], parts: [] },
    dashboardFilters: { startDate: null, endDate: null },
    charts: {},
    currentUser: null,
    unsubscribeListeners: [],
    init() { this.setupAuthUi(); this.applyTheme(localStorage.getItem('gmao-theme') || 'light'); },
    setupAuthUi() {
        const { onAuthStateChanged } = window.firebase;
        onAuthStateChanged(window.auth, user => { if (user) { this.currentUser = user; this.startApp(); } else { this.currentUser = null; this.showLoginScreen(); } });
        document.getElementById('login-form').addEventListener('submit', e => this.handleLogin(e));
        document.getElementById('signup-form').addEventListener('submit', e => this.handleSignup(e));
        document.getElementById('show-signup').addEventListener('click', () => { document.getElementById('login-form').style.display = 'none'; document.getElementById('signup-form').style.display = 'block'; });
        document.getElementById('show-login').addEventListener('click', () => { document.getElementById('signup-form').style.display = 'none'; document.getElementById('login-form').style.display = 'block'; });
    },
    async handleLogin(e) { e.preventDefault(); const { signInWithEmailAndPassword } = window.firebase; const email = document.getElementById('login-email').value; const password = document.getElementById('login-password').value; const errorMsg = document.getElementById('login-error-msg'); const button = e.target.querySelector('button'); button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; errorMsg.textContent = ''; try { await signInWithEmailAndPassword(window.auth, email, password); } catch (error) { errorMsg.textContent = "Email ou mot de passe incorrect."; button.disabled = false; button.textContent = 'Se connecter'; } },
    async handleSignup(e) { e.preventDefault(); const { createUserWithEmailAndPassword } = window.firebase; const email = document.getElementById('signup-email').value; const password = document.getElementById('signup-password').value; const errorMsg = document.getElementById('signup-error-msg'); const button = e.target.querySelector('button'); button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; errorMsg.textContent = ''; try { await createUserWithEmailAndPassword(window.auth, email, password); } catch (error) { errorMsg.textContent = "Erreur : mot de passe trop court ou email invalide."; button.disabled = false; button.textContent = 'Créer un compte'; } },
    showLoginScreen() { document.querySelector('.app-container').style.display = 'none'; document.getElementById('auth-container').style.display = 'flex'; this.unsubscribeListeners.forEach(unsub => unsub()); this.unsubscribeListeners = []; },
    startApp() { document.getElementById('auth-container').style.display = 'none'; document.querySelector('.app-container').style.display = 'block'; this.setupEventListeners(); this.attachRealtimeListeners(); },
    attachRealtimeListeners() {
        const { collection, onSnapshot } = window.firebase; if (!this.currentUser) return;
        this.unsubscribeListeners.forEach(unsub => unsub()); this.unsubscribeListeners = [];
        const collections = ['equipments', 'technicians', 'interventions', 'parts']; const basePath = `users/${this.currentUser.uid}`;
        collections.forEach(colName => { const unsub = onSnapshot(collection(window.db, basePath, colName), (snapshot) => { this.data[colName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); this.renderCurrentPage(); }); this.unsubscribeListeners.push(unsub); });
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
    renderCurrentPage() { const hash = window.location.hash || '#dashboard'; this.updateLowStockNotification(); this.updateButtonVisibility(hash); switch (hash) { case '#dashboard': this.renderDashboard(); break; case '#equipments': this.renderListPage('equipments'); break; case '#interventions': this.renderInterventionsPage(); break; case '#parts': this.renderPartsPage(); break; case '#technicians': this.renderListPage('technicians'); break; } },
    async handleSubmit(event) {
        event.preventDefault();
        const { doc, addDoc, setDoc, collection, runTransaction } = window.firebase;
        const form = event.target; const type = form.dataset.type; const formData = new FormData(form);
        const id = formData.get('id'); let itemData = Object.fromEntries(formData.entries());
        const newPartsUsed = {};
        if (type === 'interventions') { form.querySelectorAll('.used-part-item').forEach(item => { const partId = item.dataset.partId; const qtyInput = item.querySelector('input'); const qty = parseInt(qtyInput.value, 10); if (qty > 0) { newPartsUsed[partId] = qty; } }); itemData.partsUsed = newPartsUsed; }
        delete itemData.id;
        const path = `users/${this.currentUser.uid}/${type}`;
        try {
            if (type === 'parts' && !id && itemData.reference) { if (this.data.parts.find(p => p.reference && p.reference.toLowerCase() === itemData.reference.toLowerCase())) { this.showAlert("Erreur : Une pièce avec cette référence existe déjà."); return; } }
            if (type === 'interventions') {
                await runTransaction(window.db, async (transaction) => {
                    const oldIntervention = id ? this.data.interventions.find(i => i.id === id) : null;
                    const oldPartsUsed = oldIntervention?.partsUsed || {}; const wasCompleted = oldIntervention?.status === 'completed'; const isNowCompleted = itemData.status === 'completed'; const allPartIds = new Set([...Object.keys(oldPartsUsed), ...Object.keys(newPartsUsed)]);
                    for (const partId of allPartIds) {
                        const oldQty = wasCompleted ? (oldPartsUsed[partId] || 0) : 0; const newQty = isNowCompleted ? (newPartsUsed[partId] || 0) : 0; const change = oldQty - newQty;
                        if (change !== 0) { const partRef = doc(window.db, `users/${this.currentUser.uid}/parts`, partId); const partDoc = await transaction.get(partRef); if (partDoc.exists()) { const currentQuantity = Number(partDoc.data().quantity); if (currentQuantity + change < 0) { throw `Stock insuffisant pour ${partDoc.data().name}.`; } transaction.update(partRef, { quantity: currentQuantity + change }); } }
                    }
                    if (id) { transaction.set(doc(window.db, path, id), itemData, { merge: true }); } else { itemData.otNumber = `OT-${Date.now()}`; transaction.set(doc(collection(window.db, path)), itemData); }
                });
            } else { if (id) { await setDoc(doc(window.db, path, id), itemData, { merge: true }); } else { await addDoc(collection(window.db, path), itemData); } }
            this.closeModal('formModal');
        } catch (e) { console.error("Erreur Firestore: ", e); this.showAlert(e.toString()); }
    },
    async deleteItem(type, id) { const confirmed = await this.showConfirm('Voulez-vous vraiment supprimer cet élément ?'); if (!confirmed) return; const { doc, deleteDoc } = window.firebase; const path = `users/${this.currentUser.uid}/${type}/${id}`; try { await deleteDoc(doc(window.db, path)); this.closeModal('formModal'); } catch (e) { console.error("Erreur Firestore: ", e); this.showAlert("Une erreur est survenue."); } },
    getFilteredInterventions(filters) { const { startDate, endDate } = filters; if (!startDate && !endDate) return this.data.interventions; return this.data.interventions.filter(i => { const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }); },
    renderDashboard() {
        const dateStartInput = document.getElementById('date-start'); const dateEndInput = document.getElementById('date-end');
        if (!this.dashboardFilters.startDate || !this.dashboardFilters.endDate) { const endDate = new Date(); const startDate = new Date(); startDate.setDate(endDate.getDate() - 30); this.dashboardFilters.startDate = startDate.toISOString().slice(0,10); this.dashboardFilters.endDate = endDate.toISOString().slice(0,10); }
        dateStartInput.value = this.dashboardFilters.startDate; dateEndInput.value = this.dashboardFilters.endDate;
        document.getElementById('filter-btn').addEventListener('click', () => { this.dashboardFilters.startDate = dateStartInput.value; this.dashboardFilters.endDate = dateEndInput.value; this.renderDashboard(); });
        if (this.data.interventions.length === 0 && this.data.equipments.length === 0) { document.getElementById('test-data-card').style.display = 'block'; } else { document.getElementById('test-data-card').style.display = 'none'; }
        const filteredInterventions = this.getFilteredInterventions(this.dashboardFilters);
        const recentList = document.getElementById('recent-interventions-list');
        const sorted = [...this.data.interventions].sort((a,b) => new Date(b.date) - new Date(a.date));
        recentList.innerHTML = sorted.length ? sorted.slice(0, 5).map(item => this.getItemTemplate('interventions', item)).join('') : `<div class="loading-message">Aucune intervention récente.</div>`;
        this.calculateAndDisplayKPIs(filteredInterventions);
        this.renderAnalysisCharts(filteredInterventions);
    },
    renderListPage(type) { const searchTerm = document.getElementById(`${type.slice(0, -1)}-search`).value; this.renderList(type, this.data[type], searchTerm); },
    renderInterventionsPage() {
        ['intervention-date-start', 'intervention-date-end'].forEach(id => { document.getElementById(id).addEventListener('input', () => this.renderInterventionsPage()); });
        document.getElementById('intervention-search').addEventListener('input', () => this.renderInterventionsPage());
        const startDate = document.getElementById('intervention-date-start').value; const endDate = document.getElementById('intervention-date-end').value; const searchTerm = document.getElementById('intervention-search').value.toLowerCase();
        const filteredByDate = this.getFilteredInterventions({ startDate, endDate }); const filteredBySearch = filteredByDate.filter(item => (item.desc.toLowerCase().includes(searchTerm)) || (item.otNumber && item.otNumber.toLowerCase().includes(searchTerm)));
        this.renderList('interventions', filteredBySearch, '');
        const typeCounts = filteredByDate.reduce((acc, item) => { if (item.type) acc[item.type] = (acc[item.type] || 0) + 1; return acc; }, {});
        this.createChart('ratioChartCanvas', 'doughnut', { labels: Object.keys(typeCounts), datasets: [{ data: Object.values(typeCounts), backgroundColor: ['#4A90E2', '#F5A623', '#50E3C2'] }] }, { plugins: { legend: { position: 'top' } } });
    },
    renderPartsPage() {
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
            case 'equipments': icon = `<div class="item-icon bg-blue"><i class="fas fa-cogs"></i></div>`; title = item.name; subtitle = item.location; actions = `<i class="fas fa-edit action-icon" data-action="edit"></i><i class="fas fa-qrcode action-icon" data-action="qr"></i>`; break;
            case 'interventions': const eq = this.data.equipments.find(e => e.id === item.eqId); icon = `<div class="item-icon bg-orange"><i class="fas fa-wrench"></i></div>`; title = `${item.otNumber || ''}: ${item.desc}`; subtitle = `${eq ? eq.name : 'N/A'} - ${item.date ? new Date(item.date).toLocaleDateString() : ''}`; const statusClasses = { planned: 'status-planned', progress: 'status-progress', completed: 'status-completed' }; actions = `<span class="status-badge ${statusClasses[item.status]}">${item.status}</span>`; if (item.downtimeStart && item.downtimeEnd) details = `<div class="item-details"><span class="detail-badge"><i class="fas fa-clock"></i> ${this.formatDuration(new Date(item.downtimeEnd) - new Date(item.downtimeStart))}</span></div>`; break;
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
        const form = document.getElementById('mainForm'); const modalTitle = document.getElementById('modalTitle'); let html = '', title = '', item = null; const eqOptions = this.data.equipments.map(e => `<option value="${e.id}">${e.name}</option>`).join(''); const techOptions = this.data.technicians.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        switch (type) {
            case 'interventions': item = id ? this.data.interventions.find(i => i.id === id) : {}; title = id ? 'Modifier Intervention' : 'Nouvelle Intervention'; html = `<input type="hidden" name="id" value="${item.id || ''}"><div class="form-group"><label>Description</label><input type="text" name="desc" class="form-control" value="${item.desc || ''}" required></div><div class="form-group"><label>Date</label><input type="date" name="date" class="form-control" value="${item.date || new Date().toISOString().slice(0,10)}" required></div><div class="form-group"><label>Type</label><select name="type" class="form-control"><option value="Préventive">Préventive</option><option value="Corrective">Corrective</option></select></div><div class="form-group"><label>Statut</label><select name="status" class="form-control"><option value="planned">planned</option><option value="progress">progress</option><option value="completed">completed</option></select></div><div class="form-group"><label>Équipement</label><select name="eqId" class="form-control">${eqOptions}</select></div><div class="form-group"><label>Technicien</label><select name="techId" class="form-control">${techOptions}</select></div><div class="form-group"><label>Pièces utilisées</label><div id="used-parts-container"></div><input type="text" id="part-search-input" class="form-control" placeholder="Rechercher une pièce..."><div class="parts-search-results" id="parts-search-results"></div></div><hr style="border: 1px solid var(--border-color); margin: 20px 0;"><div class="form-group"><label>Début intervention</label><input type="datetime-local" name="downtimeStart" class="form-control" value="${item.downtimeStart || ''}"></div><div class="form-group"><label>Fin intervention</label><input type="datetime-local" name="downtimeEnd" class="form-control" value="${item.downtimeEnd || ''}"></div>`; break;
            case 'parts': item = id ? this.data.parts.find(p => p.id === id) : {}; title = id ? 'Modifier Pièce' : 'Nouvelle Pièce'; html = `<input type="hidden" name="id" value="${item.id || ''}"><div class="form-group"><label>Nom</label><input type="text" name="name" class="form-control" value="${item.name || ''}" required></div><div class="form-group"><label>Référence</label><input type="text" name="reference" class="form-control" value="${item.reference || ''}"></div><div class="form-group"><label>Fournisseur</label><input type="text" name="supplier" class="form-control" value="${item.supplier || ''}"></div><div class="form-group"><label>Prix Unitaire (HT)</label><input type="number" step="0.01" name="unitPrice" class="form-control" value="${item.unitPrice || 0}"></div><div class="form-group"><label>Quantité</label><input type="number" name="quantity" class="form-control" value="${item.quantity || 0}" required ${id ? 'readonly' : ''}></div><div class="form-group"><label>Quantité Minimum</label><input type="number" name="minQuantity" class="form-control" value="${item.minQuantity || 0}" required></div><div class="form-group"><label>Délai Livraison (jours)</label><input type="number" name="delaiLivraison" class="form-control" value="${item.delaiLivraison || 0}"></div>`; break;
            default: const typeLabels = { equipments: 'Équipement', technicians: 'Technicien' }; title = id ? `Modifier ${typeLabels[type]}` : `Nouveau ${typeLabels[type]}`; item = id ? this.data[type].find(e => e.id === id) : {}; const fields = { equipments: [{label: 'Nom', name: 'name'}, {label: 'Localisation', name: 'location'}], technicians: [{label: 'Nom', name: 'name'}, {label: 'Spécialité', name: 'specialty'}] }; html = `<input type="hidden" name="id" value="${item.id || ''}">`; fields[type].forEach(field => { html += `<div class="form-group"><label>${field.label}</label><input type="text" name="${field.name}" class="form-control" value="${item[field.name] || ''}" required></div>`; }); break;
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
    showPartDetails(id) { const part = this.data.parts.find(p => p.id === id); if (!part) return; document.getElementById('partDetailModalTitle').textContent = `Détails pour ${part.name}`; const contentEl = document.getElementById('partDetailContent'); contentEl.innerHTML = `<div class="date-filter-grid"><div class="form-group" style="margin:0;"><label>Début</label><input type="date" id="part-detail-start" class="form-control"></div><div class="form-group" style="margin:0;"><label>Fin</label><input type="date" id="part-detail-end" class="form-control"></div></div><div class="form-group" style="margin-top: 20px;"><label>Ajouter un approvisionnement</label><div style="display: flex; gap: 10px;"><input type="number" id="part-supply-qty" class="form-control" placeholder="Quantité"><input type="text" id="part-supply-po" class="form-control" placeholder="N° BC"><button id="add-supply-btn" class="btn"><i class="fas fa-plus"></i></button></div></div><h4 style="margin-top: 20px;">Historique des mouvements</h4><div id="part-detail-history"></div>`; const calculateDetails = () => { const startDate = document.getElementById('part-detail-start').value; const endDate = document.getElementById('part-detail-end').value; const consumptions = this.data.interventions.filter(i => { if (!i.partsUsed || !i.partsUsed[id] || i.status !== 'completed') return false; const iDate = new Date(i.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && iDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (iDate > end) return false; } return true; }).map(i => ({ date: i.date, type: 'Consommation', quantity: `-${i.partsUsed[id]}`, details: `${i.otNumber || 'N/A'} sur ${this.data.equipments.find(e => e.id === i.eqId)?.name || 'N/A'}` })); const supplies = (part.history || []).filter(h => { if (h.type !== 'approvisionnement') return false; const hDate = new Date(h.date); const start = startDate ? new Date(startDate) : null; const end = endDate ? new Date(endDate) : null; if (start && hDate < start) return false; if (end) { end.setHours(23, 59, 59, 999); if (hDate > end) return false; } return true; }).map(h => ({ ...h, quantity: `+${h.quantity}` })); const history = [...consumptions, ...supplies].sort((a,b) => new Date(b.date) - new Date(a.date)); const historyEl = document.getElementById('part-detail-history'); if (history.length === 0) { historyEl.innerHTML = '<p>Aucun mouvement.</p>'; } else { let tableHTML = '<table class="detail-table"><tr><th>Date</th><th>Type</th><th>Détails</th><th>Qté</th></tr>'; history.forEach(h => { tableHTML += `<tr><td>${new Date(h.date).toLocaleDateString()}</td><td>${h.type}</td><td>${h.details}</td><td>${h.quantity}</td></tr>`; }); tableHTML += '</table>'; historyEl.innerHTML = tableHTML; } }; document.getElementById('add-supply-btn').addEventListener('click', async () => { const qty = parseInt(document.getElementById('part-supply-qty').value, 10); const poNumber = document.getElementById('part-supply-po').value; if (qty > 0) { const { doc, runTransaction } = window.firebase; const partRef = doc(window.db, `users/${this.currentUser.uid}/parts`, id); try { await runTransaction(window.db, async (transaction) => { const partDoc = await transaction.get(partRef); if (partDoc.exists()) { const newQuantity = Number(partDoc.data().quantity) + qty; const newHistory = partDoc.data().history || []; newHistory.push({ date: new Date().toISOString().slice(0,10), type: 'approvisionnement', quantity: qty, details: `BC: ${poNumber}` }); transaction.update(partRef, { quantity: newQuantity, history: newHistory }); } }); document.getElementById('part-supply-qty').value = ''; document.getElementById('part-supply-po').value = ''; } catch (e) { this.showAlert("Erreur."); } } }); document.getElementById('part-detail-start').onchange = calculateDetails; document.getElementById('part-detail-end').onchange = calculateDetails; calculateDetails(); this.openModal('partDetailModal'); },
    closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); },
    showQRCode(id) { const eq = this.data.equipments.find(e => e.id === id); if(!eq) return; const qrContainer = document.getElementById('qrCodeCanvas'); qrContainer.innerHTML = ''; document.getElementById('qrEquipmentName').textContent = eq.name; new QRCode(qrContainer, { text: `gmao://equipment/${eq.id}`, width: 200, height: 200 }); this.openModal('qrModal'); },
    toggleTheme() { const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark'; this.applyTheme(newTheme); localStorage.setItem('gmao-theme', newTheme); },
    applyTheme(theme) { const icon = document.querySelector('.theme-switcher'); if (theme === 'dark') { document.body.classList.add('dark-mode'); icon.classList.replace('fa-moon', 'fa-sun'); } else { document.body.classList.remove('dark-mode'); icon.classList.replace('fa-sun', 'fa-moon'); } },
    formatDuration(ms, long = false) { if (ms <= 0 || !ms) return long ? "0j 0h 0m" : "0m"; const days = Math.floor(ms / 86400000); const hours = Math.floor((ms % 86400000) / 3600000); const minutes = Math.floor((ms % 3600000) / 60000); if (long) return `${days}j ${hours}h ${minutes}m`; let result = ''; if (days > 0) result += `${days}j `; if (hours > 0) result += `${hours}h `; result += `${minutes}m`; return result.trim() || "0m"; },
    setupEventListeners() {
        document.getElementById('logout-btn').addEventListener('click', () => { const { signOut } = window.firebase; signOut(window.auth); });
        document.getElementById('whatsapp-btn').addEventListener('click', () => this.openModal('whatsappModal'));
        window.addEventListener('hashchange', () => this.navigateTo(window.location.hash));
        document.querySelector('.bottom-nav').addEventListener('click', e => { const navItem = e.target.closest('.nav-item'); if (navItem) { e.preventDefault(); this.navigateTo(navItem.getAttribute('href')); } });
        document.getElementById('fab-add-button').addEventListener('click', () => { const page = (window.location.hash || '#dashboard').substring(1); if (page !== 'dashboard' && page !== '') this.openForm(page); });
        document.querySelectorAll('.modal').forEach(modal => { modal.addEventListener('click', e => { if (e.target === modal || e.target.classList.contains('close-modal')) this.closeModal(modal.id); }); });
        document.getElementById('mainForm').addEventListener('submit', this.handleSubmit.bind(this));
        document.querySelector('.theme-switcher').addEventListener('click', this.toggleTheme.bind(this));
        
        document.querySelector('.app-container').addEventListener('click', e => {
            const actionIcon = e.target.closest('.action-icon');
            const listItem = e.target.closest('.list-item-clickable');

            if (actionIcon && listItem) {
                e.stopPropagation();
                const type = listItem.dataset.type;
                const id = listItem.dataset.id;
                const action = actionIcon.dataset.action;

                if (action === 'edit') { this.openForm(type, id); } 
                else if (action === 'qr') { this.showQRCode(id); }

            } else if (listItem) {
                const type = listItem.dataset.type;
                const id = listItem.dataset.id;
                switch (type) {
                    case 'technicians': this.showTechnicianStats(id); break;
                    case 'equipments': this.showEquipmentDetails(id); break;
                    case 'parts': this.showPartDetails(id); break;
                    default: this.openForm(type, id); break;
                }
            }
        });
        
        document.getElementById('add-test-data-btn').addEventListener('click', () => this.addTestData(), { once: true });
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
        if (!this.currentUser) return this.showAlert("Vous devez être connecté pour ajouter des données.");
        const btn = document.getElementById('add-test-data-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ajout en cours...';

        const { writeBatch, doc, collection } = window.firebase; const batch = writeBatch(window.db); const basePath = `users/${this.currentUser.uid}`;
        const eq1 = doc(collection(window.db, basePath, "equipments")); const eq2 = doc(collection(window.db, basePath, "equipments")); const eq3 = doc(collection(window.db, basePath, "equipments")); const eq4 = doc(collection(window.db, basePath, "equipments")); const eq5 = doc(collection(window.db, basePath, "equipments"));
        const tech1 = doc(collection(window.db, basePath, "technicians")); const tech2 = doc(collection(window.db, basePath, "technicians")); const tech3 = doc(collection(window.db, basePath, "technicians"));
        const testData = {
            equipments: [ { id: eq1.id, name: "Presse Hydraulique P1", location: "Atelier A" }, { id: eq2.id, name: "Robot de soudure R2", location: "Ligne 3" }, { id: eq3.id, name: "Compresseur d'air C-500", location: "Salle machines" }, { id: eq4.id, name: "Pont Roulant PR-01", location: "Expédition" }, { id: eq5.id, name: "Four thermique FTT-8", location: "Atelier B" } ],
            technicians: [ { id: tech1.id, name: "Jean Dupont", specialty: "Mécanique" }, { id: tech2.id, name: "Amina El Fassi", specialty: "Électronique" }, { id: tech3.id, name: "Marc Petit", specialty: "Hydraulique" } ],
            parts: [ { name: "Filtre à huile H-123", reference: "F-5540", supplier: "Fournisseur A", quantity: 12, minQuantity: 5, delaiLivraison: 3, unitPrice: 150.50 }, { name: "Roulement 6204-2RS", reference: "R-6204", supplier: "Fournisseur B", quantity: 3, minQuantity: 4, delaiLivraison: 7, unitPrice: 80 }, { name: "Sonde de température PT100", reference: "S-PT100", supplier: "Fournisseur C", quantity: 8, minQuantity: 3, delaiLivraison: 5, unitPrice: 350 } ],
            interventions: [
                { eqId: eq1.id, techId: tech3.id, desc: "Surchauffe hydraulique", type: "Corrective", date: "2025-08-22", status: "completed", downtimeStart: "2025-08-22T14:00", downtimeEnd: "2025-08-22T18:00" },
                { eqId: eq3.id, techId: tech1.id, desc: "Fuite d'air importante", type: "Corrective", date: "2025-08-18", status: "completed", downtimeStart: "2025-08-18T10:00", downtimeEnd: "2025-08-18T15:00" },
                { eqId: eq5.id, techId: tech2.id, desc: "Sonde température HS", type: "Corrective", date: "2025-08-15", status: "completed", downtimeStart: "2025-08-15T08:00", downtimeEnd: "2025-08-15T11:00" },
                { eqId: eq2.id, techId: tech2.id, desc: "Problème de pince", type: "Corrective", date: "2025-08-20", status: "completed", downtimeStart: "2025-08-20T09:00", downtimeEnd: "2025-08-20T11:00" },
                { eqId: eq4.id, techId: tech1.id, desc: "Graissage annuel", type: "Préventive", date: "2025-08-25", status: "planned" }
            ]
        };
        try {
            testData.equipments.forEach(item => batch.set(doc(window.db, basePath, "equipments", item.id), item));
            testData.technicians.forEach(item => batch.set(doc(window.db, basePath, "technicians", item.id), item));
            testData.parts.forEach(item => batch.set(doc(collection(window.db, basePath, "parts")), item));
            testData.interventions.forEach(item => batch.set(doc(collection(window.db, basePath, "interventions")), item));
            await batch.commit();
            this.showAlert("Données de test ajoutées avec succès !");
        } catch (e) { console.error("Erreur ajout données: ", e); this.showAlert("Erreur lors de l'ajout des données."); }
    }
};

// Lancement de l'application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GMAOApp.init());
} else {
    GMAOApp.init();
}
