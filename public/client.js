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
const targetEmojiSequenceSpan = document.getElementById('target-emoji-sequence'); // Elemento para exibir a sequência alvo

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

function updateParticipantsList(participants) {
    participantesList.innerHTML = '';
    if (participants && participants.length > 0) {
        participants.forEach(p => {
            const li = document.createElement('li');
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
                    winnersHtml += `<div class="winner-item">
                        <span class="winner-name">${winner.nome}</span>
                        <div class="winner-details">
                            <span>Emoji: ${winner.emoji_sequence}</span>
                            <span>Pontuação: ${winner.score}</span>
                        </div>
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
    // Atualiza a exibição da sequência alvo para todos
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

// Apenas o administrador pode clicar no botão de sortear
sortearBtn.addEventListener('click', () => {
    // Basicamente, este botão só será visível e habilitado para o admin
    // A validação real de quem pode sortear acontece no server.js
    socket.emit('performDraw');
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
    // Exibe a sequência alvo para todos na inicialização
    targetEmojiSequenceSpan.textContent = data.config.target_emoji_sequence; // **NOVO**
    sortearBtn.disabled = true; // Inicia desabilitado, apenas admin logado habilita
});

socket.on('participantAdded', (data) => {
    displayMessage(messageDiv, `Você entrou no sorteio, ${data.nome}! Sua sequência: ${data.emoji_sequence}`, 'success');
    updateParticipantsList(data.allParticipants);
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence; // **NOVO**
});

socket.on('participantError', (message) => {
    displayMessage(messageDiv, message, 'error');
});

socket.on('drawResult', (data) => {
    displayMessage(messageDiv, 'Sorteio Realizado! Veja os ganhadores!', 'success');
    updateLastDrawInfo(data.lastDrawTime, data.winners);
    updateParticipantsList(data.allParticipants); // Deve esvaziar a lista
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.targetSequence; // **NOVO**
});

socket.on('drawError', (message) => {
    displayMessage(messageDiv, message, 'error');
});

socket.on('adminLoginSuccess', (data) => {
    displayMessage(adminMessage, 'Login de administrador bem-sucedido!', 'success');
    adminLoginSection.style.display = 'none';
    adminControlsSection.style.display = 'block';
    sortearBtn.disabled = false; // Habilita o botão de sortear para o admin
    updateDashboardInfo(data.config, data.participantes.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence; // **NOVO**
});

socket.on('adminLoginFailed', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('configUpdated', (data) => {
    displayMessage(adminMessage, 'Configurações atualizadas com sucesso!', 'success');
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    targetEmojiSequenceSpan.textContent = data.targetSequence; // **NOVO**
});

socket.on('configError', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('sorteioReset', (data) => {
    displayMessage(adminMessage, 'Sorteio resetado com sucesso!', 'success');
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateParticipantsList(data.allParticipants);
    updateLastDrawInfo(data.lastDrawTime, data.lastWinners); // Deve limpar os últimos ganhadores
    updateSorteioHistory(data.history); // Deve limpar o histórico
    targetEmojiSequenceSpan.textContent = data.targetSequence; // **NOVO**
});