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

// Elementos para adicionar participante manualmente
const adminAddNameInput = document.getElementById('admin-add-name');
const adminAddEmojisInput = document.getElementById('admin-add-emojis');
const adminAddParticipantBtn = document.getElementById('admin-add-participant-btn');
const adminAddParticipantMessage = document.getElementById('admin-add-participant-message');

// Elementos para definir a sequência de emoji alvo
const adminTargetEmojisInput = document.getElementById('admin-target-emojis');
const setTargetEmojisBtn = document.getElementById('set-target-emojis-btn');
const targetEmojisMessage = document.getElementById('target-emojis-message');

// Elementos para adicionar participantes via JSON
const adminJsonParticipantsTextarea = document.getElementById('admin-json-participants');
const addJsonParticipantsBtn = document.getElementById('add-json-participants-btn');
const jsonParticipantsMessage = document.getElementById('json-participants-message');

// --- NOVO: Variável global para armazenar participantes do admin (para seleção) ---
let currentAdminParticipants = [];

// --- Funções de UI ---

// MODIFICADO: Função displayMessage para usar a classe 'hidden' e as cores CSS
function displayMessage(element, msg, type) {
    element.textContent = msg;
    element.className = 'message'; // Limpa classes anteriores e adiciona 'message'
    element.classList.add(type); // Adiciona a nova classe (success, error, info)
    element.classList.remove('hidden'); // Remove a classe 'hidden' para exibir
    setTimeout(() => {
        element.classList.add('hidden'); // Adiciona 'hidden' de volta para ocultar
        element.textContent = ''; // Limpa o texto após ocultar
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

            // Desabilitar checkbox se o participante já for um ganhador oficial
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
    targetEmojiSequenceSpan.textContent = config.target_emoji_sequence; // ATUALIZADO: para o dashboard principal
    adminTargetEmojisInput.value = config.target_emoji_sequence; // NOVO: para o campo do admin
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

// --- NOVO: Event Listener para adicionar participante manualmente (Admin) ---
if (adminAddParticipantBtn) {
    adminAddParticipantBtn.addEventListener('click', () => {
        const nome = adminAddNameInput.value.trim();
        const emojiSequence = adminAddEmojisInput.value.trim();

        if (!nome || !emojiSequence) {
            displayMessage(adminAddParticipantMessage, 'Por favor, preencha o nome e a sequência de emojis.', 'error');
            return;
        }

        socket.emit('adminAddParticipant', { nome, emojiSequence });
        displayMessage(adminAddParticipantMessage, 'Enviando...', 'info');
    });
}

// --- NOVO: Event Listener para definir a Sequência de Emoji Alvo (Admin) ---
if (setTargetEmojisBtn) {
    setTargetEmojisBtn.addEventListener('click', () => {
        const targetEmojis = adminTargetEmojisInput.value.trim();

        if (!targetEmojis) {
            displayMessage(targetEmojisMessage, 'Por favor, insira a sequência de emoji alvo.', 'error');
            return;
        }

        socket.emit('setTargetEmojis', { targetEmojis });
        displayMessage(targetEmojisMessage, 'Enviando...', 'info');
    });
}

// --- NOVO: Event Listener para carregar Participantes via JSON (Admin) ---
if (addJsonParticipantsBtn) {
    addJsonParticipantsBtn.addEventListener('click', () => {
        const jsonString = adminJsonParticipantsTextarea.value.trim();

        if (!jsonString) {
            displayMessage(jsonParticipantsMessage, 'Por favor, cole o JSON dos participantes.', 'error');
            return;
        }

        try {
            const participants = JSON.parse(jsonString);
            if (!Array.isArray(participants)) {
                displayMessage(jsonParticipantsMessage, 'O JSON deve ser um array de participantes.', 'error');
                return;
            }
            // Verifica se cada item no array tem 'nome' e 'emojiSequence'
            const isValid = participants.every(p => p.nome && p.emojiSequence);
            if (!isValid) {
                displayMessage(jsonParticipantsMessage, 'Cada participante no JSON deve ter "nome" e "emojiSequence".', 'error');
                return;
            }

            socket.emit('addParticipantsFromJson', { participants });
            displayMessage(jsonParticipantsMessage, 'Enviando participantes...', 'info');

        } catch (e) {
            displayMessage(jsonParticipantsMessage, 'JSON inválido. Verifique a sintaxe.', 'error');
        }
    });
}


// --- Listeners de Eventos do Socket.IO ---

socket.on('initialData', (data) => {
    updateDashboardInfo(data.config, data.participantes.length, data.lastDrawTime);
    updateParticipantsList(data.participantes);
    updateLastDrawInfo(data.lastDrawTime, data.lastWinners);
    updateSorteioHistory(data.history);
    targetEmojiSequenceSpan.textContent = data.config.target_emoji_sequence;
    adminTargetEmojisInput.value = data.config.target_emoji_sequence; // Preenche o campo do admin
    sortearBtn.disabled = true; // Inicia desabilitado, apenas admin logado habilita
});

socket.on('participantAdded', (data) => {
    displayMessage(messageDiv, `Você entrou no sorteio, ${data.nome}! Sua sequência: ${data.emoji_sequence}`, 'success');
    updateParticipantsList(data.allParticipants);
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo
    if (adminControlsSection.style.display === 'block') { // Se o admin estiver logado
        socket.emit('requestAdminParticipants'); // Pede a lista atualizada para o admin
    }
});

socket.on('participantError', (message) => {
    displayMessage(messageDiv, message, 'error');
});

// MODIFICADO: drawResult agora pode lidar com diferentes tipos de sorteio e atualizar a lista de admin
socket.on('drawResult', (data) => {
    displayMessage(messageDiv, `Sorteio "${data.type === 'extra' ? 'Extra' : 'Oficial'}" Realizado! Veja os ganhadores!`, 'success'); // NOVO: Mensagem mais clara
    updateLastDrawInfo(data.lastDrawTime, data.winners);
    updateParticipantsList(data.allParticipants); // Atualiza a lista principal com status de premiação
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateSorteioHistory(data.history);
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo
    
    // NOVO: Se for admin logado, atualiza a lista do admin também
    if (adminControlsSection.style.display === 'block') {
        socket.emit('requestAdminParticipants'); // Solicita a lista atualizada para o admin
    }
});

// NOVO: drawFilteredResult - para sorteios filtrados
socket.on('drawFilteredResult', (data) => {
    displayMessage(adminMessage, 'Sorteio Filtrado Realizado com Sucesso!', 'success');
    updateLastDrawInfo(data.lastDrawTime, data.winners); // Atualiza a área de últimos ganhadores
    updateParticipantsList(data.allParticipants); // Atualiza a lista principal com status de premiação
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    updateSorteioHistory(data.history);
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo

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
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo

    // NOVO: Solicita a lista de participantes para o painel admin após o login
    socket.emit('requestAdminParticipants');
});

socket.on('adminLoginFailed', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('configUpdated', (data) => {
    displayMessage(adminMessage, 'Configurações atualizadas com sucesso!', 'success');
    updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime);
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo
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
    // targetEmojiSequenceSpan.textContent = data.targetSequence; // Removido, já atualizado por updateDashboardInfo

    // NOVO: Limpa e re-popula a lista de admin após o reset
    if (adminControlsSection.style.display === 'block') {
        socket.emit('requestAdminParticipants');
    }
});

// --- NOVO: Listener para receber a lista de participantes para o painel admin ---
socket.on('adminParticipantsList', (participants) => {
    updateAdminParticipantsList(participants);
});

// --- NOVO: Listener para receber a confirmação de adição de participante pelo admin ---
socket.on('participantAddedByAdmin', (data) => {
    if (data.success) {
        displayMessage(adminAddParticipantMessage, `Participante "${data.participante.nome}" adicionado com sucesso!`, 'success');
        adminAddNameInput.value = ''; // Limpa os campos
        adminAddEmojisInput.value = '';
        updateParticipantsList(data.allParticipants); // Atualiza a lista principal
        updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime); // Atualiza o dashboard
        socket.emit('requestAdminParticipants'); // Solicita a lista de admin atualizada
    } else {
        displayMessage(adminAddParticipantMessage, `Erro: ${data.message}`, 'error');
    }
});

// --- NOVO: Listener para receber a confirmação de sequência de emoji alvo atualizada ---
socket.on('targetEmojisUpdated', (data) => {
    if (data.success) {
        displayMessage(targetEmojisMessage, `Sequência de Emoji Alvo definida para: ${data.targetEmojis}`, 'success');
        updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime); // Atualiza o dashboard e o campo do admin
    } else {
        displayMessage(targetEmojisMessage, `Erro: ${data.message}`, 'error');
    }
});

// --- NOVO: Listener para receber a confirmação de participantes adicionados via JSON ---
socket.on('participantsAddedFromJson', (data) => {
    if (data.success) {
        displayMessage(jsonParticipantsMessage, `Adicionados ${data.count} participantes do JSON.`, 'success');
        adminJsonParticipantsTextarea.value = ''; // Limpa o campo
        updateParticipantsList(data.allParticipants); // Atualiza a lista principal
        updateDashboardInfo(data.config, data.allParticipants.length, data.lastDrawTime); // Atualiza o dashboard
        socket.emit('requestAdminParticipants'); // Solicita a lista de admin atualizada
    } else {
        displayMessage(jsonParticipantsMessage, `Erro ao adicionar JSON: ${data.message}`, 'error');
    }
});

// --- NOVO: Listener para erros específicos de sorteio filtrado/extra
socket.on('filteredDrawError', (message) => {
    displayMessage(adminMessage, message, 'error');
});

socket.on('extraDrawError', (message) => {
    displayMessage(adminMessage, message, 'error');
});

// --- NOVO: Listener para atualizar a sequência alvo em todos os clientes ---
socket.on('updateTargetEmojis', (targetEmojis) => {
    targetEmojiSequenceSpan.textContent = targetEmojis;
    // Se o admin estiver logado, atualiza o campo dele também
    if (adminControlsSection.style.display === 'block') {
        adminTargetEmojisInput.value = targetEmojis;
    }
});