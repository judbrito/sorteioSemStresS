// client.js

const socket = io();

// Elementos da interface
const nomeInput = document.getElementById('nome');
const participarBtn = document.getElementById('participar-btn');
const messageDiv = document.getElementById('message');
const participantesList = document.getElementById('participantes-list');
const participantesCountSpan = document.getElementById('participantes-count');
const limiteParticipantesSpan = document.getElementById('limite-participantes');
const sortearBtn = document.getElementById('sortear-btn');
const winnerBoard = document.getElementById('winner-board');
const ganhadoresList = document.getElementById('ganhadores-list');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminUser = document.getElementById('admin-user');
const adminPass = document.getElementById('admin-pass');
const adminMessage = document.getElementById('admin-message');
const adminLoginSection = document.getElementById('admin-login-section');
const adminControlsSection = document.getElementById('admin-controls-section');
const newLimitInput = document.getElementById('new-limit');
const numWinnersInput = document.getElementById('num-winners');
const updateConfigBtn = document.getElementById('update-config-btn');
const resetSorteioBtn = document.getElementById('reset-sorteio-btn');
const lastDrawTimeSpan = document.getElementById('last-draw-time');
const sorteiosList = document.getElementById('sorteios-list');
const targetEmojiSequenceSpan = document.getElementById('target-emoji-sequence');

// --- NOVO: Elementos para as novas funcionalidades do Admin ---
const sortearExtraBtn = document.getElementById('sortear-extra-btn');
const adminParticipantesList = document.getElementById('admin-participantes-list');
const runFilteredSorteioBtn = document.getElementById('run-filtered-sorteio-btn');

// --- NOVO: Variável global para armazenar participantes do admin (para seleção) ---
let currentAdminParticipants = [];

// --- Funções de UI ---

function displayMessage(element, msg, type) {
    element.textContent = msg;
    element.className = ''; // Limpa classes anteriores
    element.classList.add(type); // Adiciona a nova classe (success ou error)
    element.style.display = 'block'; // Garante que a mensagem é visível
    setTimeout(() => {
        element.style.display = 'none';
        element.textContent = '';
    }, 5000); // Mensagem desaparece após 5 segundos
}

// --- NOVO: Função para atualizar a lista de participantes no PAINEL ADMIN com checkboxes ---
function updateAdminParticipantsList(participants) {
    adminParticipantesList.innerHTML = '';
    if (participants && participants.length > 0) {
        participants.forEach(p => {
            const li = document.createElement('li');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `admin-participant-${p.id}`; // Assumimos que o participante tem um ID
            checkbox.value = p.id;
            checkbox.name = 'excludedParticipants';

            // NOVO: Desabilitar checkbox se o participante já for um ganhador oficial
            // Assumimos que o status_premio vem do server
            if (p.status_premio === 'premiado_oficial') {
                checkbox.disabled = true;
                li.classList.add('winner-official-checkbox-disabled'); // Opcional: Adicionar classe para estilizar
            }

            const label = document.createElement('label');
            label.htmlFor = `admin-participant-${p.id}`;
            label.innerHTML = `<span>${p.nome}</span> <span class="emoji-sequence">${p.emoji_sequence}</span>`;

            li.appendChild(checkbox);
            li.appendChild(label);
            adminParticipantesList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'Nenhum participante para gerenciar.';
        adminParticipantesList.appendChild(li);
    }
    currentAdminParticipants = participants; // Salva a lista para referência futura
}


function updateParticipantsList(participants) {
    participantesList.innerHTML = '';
    if (participants && participants.length > 0) {
        participants.forEach(p => {
            const li = document.createElement('li');
            // NOVO: Aplicar classes de cor com base no status de premiação
            if (p.status_premio === 'premiado_oficial') {
                li.classList.add('winner-official');
            } else if (p.status_premio === 'premiado_extra') {
                li.classList.add('winner-extra');
            }
            li.innerHTML = `<span>${p.nome}</span> <span class="emoji-sequence">${p.emoji_sequence}</span>`;
            participantesList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'Nenhum participante ainda.';
        participantesList.appendChild(li);
    }
}

function updateSorteioHistory(history) {
    sorteiosList.innerHTML = '';
    if (history && history.length > 0) {
        // Inverte a ordem para mostrar os mais recentes primeiro
        [...history].reverse().forEach(entry => {
            const li = document.createElement('li');
            const date = new Date(entry.timestamp).toLocaleString('pt-BR');
            let winnersHtml = '';
            if (entry.winners && entry.winners.length > 0) {
                entry.winners.forEach(winner => {
                    // NOVO: Adicionar classes de cor ao vencedor no histórico
                    let winnerClass = '';
                    if (winner.status_premio === 'premiado_oficial') {
                        winnerClass = 'winner-official';
                    } else if (winner.status_premio === 'premiado_extra') {
                        winnerClass = 'winner-extra';
                    }
                    winnersHtml += `<div class="winner-item ${winnerClass}">
                        <span class="winner-name">${winner.nome}</span>
                        <div class="winner-details">
                            <span>Emoji: ${winner.emoji_sequence}</span>
                            <span>Pontuação: ${winner.score}</span>
                            <span>Tipo: ${entry.tipo_sorteio === 'extra' ? 'Sorteio Extra' : 'Sorteio Oficial'}</span> </div>
                    </div>`;
                });
            } else {
                winnersHtml = '<p>Nenhum ganhador nesta rodada.</p>';
            }

            li.innerHTML = `
                <strong>Sorteio em: ${date}</strong><br>
                <span>Sequência Alvo: ${entry.target_emoji_sequence}</span>
                <div style="margin-top: 10px;">${winnersHtml}</div>
            `;
            sorteiosList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'Nenhum sorteio realizado ainda.';
        sorteiosList.appendChild(li);
    }
}

function updateLastDrawInfo(time, winners) {
    if (time) {
        lastDrawTimeSpan.textContent = new Date(time).toLocaleString('pt-BR');
    } else {
        lastDrawTimeSpan.textContent = 'N/A';
    }

    ganhadoresList.innerHTML = '';
    if (winners && winners.length > 0) {
        winnerBoard.style.display = 'block';
        winners.forEach(winner => {
            const li = document.createElement('li');
            // NOVO: Adicionar classes de cor ao vencedor na lista de últimos ganhadores
            let winnerClass = '';
            if (winner.status_premio === 'premiado_oficial') {
                winnerClass = 'winner-official';
            } else if (winner.status_premio === 'premiado_extra') {
                winnerClass = 'winner-extra';
            }
            li.classList.add(winnerClass); // Aplica a classe de cor aqui
            li.innerHTML = `
                <strong>${winner.nome}</strong>
                <div class="details">
                    Emojis: ${winner.emoji_sequence} | Pontuação: ${winner.score}
                </div>
            `;
            ganhadoresList.appendChild(li);
        });
    } else {
        winnerBoard.style.display = 'none';
    }
}

function updateDashboardInfo(config, participantsCount, lastDrawTime) {
    participantesCountSpan.textContent = participantsCount;
    limiteParticipantesSpan.textContent = config.limite_participantes;
    newLimitInput.value = config.limite_participantes;
    numWinnersInput.value = config.num_winners;
    targetEmojiSequenceSpan.textContent = config.target_emoji_sequence;
    if (lastDrawTime) {
        lastDrawTimeSpan.textContent = new Date(lastDrawTime).toLocaleString('pt-BR');
    } else {
        lastDrawTimeSpan.textContent = 'N/A';
    }
}


// --- Event Listeners dos Botões ---

participarBtn.addEventListener('click', () => {
    const nome = nomeInput.value.trim();
    if (nome) {
        socket.emit('addParticipant', { nome: nome });
    } else {
        displayMessage(messageDiv, 'Por favor, digite seu nome.', 'error');
    }
});

// MODIFICADO: sortearBtn agora dispara o sorteio "original/trial"
sortearBtn.addEventListener('click', () => {
    socket.emit('performDraw', { type: 'trial' }); // Envia o tipo de sorteio
});

// NOVO: Event listener para o botão de sorteio extra
sortearExtraBtn.addEventListener('click', () => {
    socket.emit('performDraw', { type: 'extra' }); // Envia o tipo de sorteio
});

// NOVO: Event listener para o botão de sorteio filtrado (no painel admin)
runFilteredSorteioBtn.addEventListener('click', () => {
    const selectedCheckboxes = adminParticipantesList.querySelectorAll('input[name="excludedParticipants"]:checked');
    const participantsToExclude = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (confirm(`Tem certeza que deseja realizar o sorteio filtrado, excluindo ${participantsToExclude.length} participantes?`)) {
        socket.emit('performFilteredDraw', { excludedIds: participantsToExclude });
    }
});


adminLoginBtn.addEventListener('click', () => {
    const user = adminUser.value.trim();
    const pass = adminPass.value.trim();
    if (user && pass) {
        socket.emit('adminLogin', { user, pass });
    } else {
        displayMessage(adminMessage, 'Por favor, insira usuário e senha.', 'error');
    }
});

updateConfigBtn.addEventListener('click', () => {
    const newLimit = parseInt(newLimitInput.value);
    const numWinners = parseInt(numWinnersInput.value);
    socket.emit('updateConfig', { limite_participantes: newLimit, num_winners: numWinners });
});

resetSorteioBtn.addEventListener('click', () => {
    if (confirm('Tem certeza que deseja resetar todo o sorteio e apagar histórico e participantes?')) {
        socket.emit('resetSorteio');
    }
});

// --- Listeners de Eventos do Socket.IO ---

socket.on('initialData', (data) => {
    updateDashboardInfo(data.config, data.participantes.length, data.lastDrawTime);
    updateParticipantsList(data.participantes);
    updateLastDrawInfo(data.lastDrawTime, data.lastWinners);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.config.target_emoji_sequence;
    sortearBtn.disabled = true; // Inicia desabilitado, apenas admin logado habilita
});

socket.on('participantAdded', (data) => {
    displayMessage(messageDiv, `Você entrou no sorteio, ${data.nome}! Sua sequência: ${data.emoji_sequence}`, 'success');
    updateParticipantsList(data.allParticipants);
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence;
});

socket.on('participantError', (message) => {
    displayMessage(messageDiv, message, 'error');
});

// MODIFICADO: drawResult agora pode lidar com diferentes tipos de sorteio e atualizar a lista de admin
socket.on('drawResult', (data) => {
    displayMessage(messageDiv, `Sorteio "${data.type === 'extra' ? 'Extra' : 'Trial'}" Realizado! Veja os ganhadores!`, 'success'); // NOVO: Mensagem mais clara
    updateLastDrawInfo(data.lastDrawTime, data.winners);
    updateParticipantsList(data.allParticipants); // Atualiza a lista principal com status de premiação
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.targetSequence;
    
    // NOVO: Se for admin logado, atualiza a lista do admin também
    if (adminControlsSection.style.display === 'block') {
        socket.emit('requestAdminParticipants'); // Solicita a lista atualizada para o admin
    }
});

// NOVO: drawFilteredResult - para sorteios filtrados
socket.on('drawFilteredResult', (data) => {
    displayMessage(adminMessage, 'Sorteio Filtrado Realizado com Sucesso!', 'success');
    // Você pode querer exibir os resultados específicos do sorteio filtrado em um local diferente ou no histórico geral
    updateLastDrawInfo(data.lastDrawTime, data.winners); // Atualiza a área de últimos ganhadores
    updateParticipantsList(data.allParticipants); // Atualiza a lista principal com status de premiação
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.targetSequence;

    // Se for admin logado, atualiza a lista do admin também
    if (adminControlsSection.style.display === 'block') {
        socket.emit('requestAdminParticipants'); // Solicita a lista atualizada para o admin
    }
});

socket.on('drawError', (message) => {
    displayMessage(messageDiv, message, 'error');
});

socket.on('adminLoginSuccess', (data) => {
    displayMessage(adminMessage, 'Login de administrador bem-sucedido!', 'success');
    adminLoginSection.style.display = 'none';
    adminControlsSection.style.display = 'block';
    sortearBtn.disabled = false; // Habilita o botão de sortear "Trial"
    sortearExtraBtn.style.display = 'inline-block'; // NOVO: Mostra o botão de sorteio extra
    
    updateDashboardInfo(data.config, data.participantes.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence;

    // NOVO: Solicita a lista de participantes para o painel admin após o login
    socket.emit('requestAdminParticipants');
});

socket.on('adminLoginFailed', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('configUpdated', (data) => {
    displayMessage(adminMessage, 'Configurações atualizadas com sucesso!', 'success');
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence;
});

socket.on('configError', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('sorteioReset', (data) => {
    displayMessage(adminMessage, 'Sorteio resetado com sucesso!', 'success');
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateParticipantsList(data.allParticipants);
    updateLastDrawInfo(data.lastDrawTime, data.lastWinners);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.targetSequence;

    // NOVO: Limpa e re-popula a lista de admin após o reset
    if (adminControlsSection.style.display === 'block') {
        socket.emit('requestAdminParticipants');
    }
});

// --- NOVO: Listener para receber a lista de participantes para o painel admin ---
socket.on('adminParticipantsList', (participants) => {
    updateAdminParticipantsList(participants);
});

// --- NOVO: Listener para erros específicos de sorteio filtrado/extra
socket.on('filteredDrawError', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('extraDrawError', (message) => {
    displayMessage(adminMessage, message, 'error');
});