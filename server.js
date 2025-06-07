// server.js

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb'); // Importa o cliente MongoDB e ObjectId
const fs = require('fs'); // --- NOVO: Módulo para manipulação de arquivos
const util = require('util'); // --- NOVO: Para usar fs.readFile/writeFile com Promises

// --- NOVO: Promisify fs functions for async/await
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Configurações do Banco de Dados ---
const MONGODB_URI = process.env.MONGODB_URI; // Já pega do .env
const DB_NAME = 'SorteioDB';
const COLLECTION_PARTICIPANTS = 'participants';
const COLLECTION_HISTORY = 'sorteioHistory';
const COLLECTION_CONFIG = 'config';

let db; // Variável para armazenar a conexão com o banco de dados

// --- Caminhos para arquivos JSON de persistência secundária ---
const DATA_DIR = path.join(__dirname, 'data'); // Pasta para os arquivos JSON
const PREMIADOS_EXTRAS_FILE = path.join(DATA_DIR, 'premiados_extras.json');
const EXCLUIDOS_MANUAIS_FILE = path.join(DATA_DIR, 'excluidos_manuais.json');
const PREMIADOS_OFICIAIS_FIXOS_FILE = path.join(DATA_DIR, 'premiados_oficiais_fixos.json'); // Para os 6 fixos

// Garante que a pasta 'data' existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// --- Variáveis para dados persistidos em JSON ---
let premiadosExtras = []; // Vencedores de sorteios extra/filtrados
let excluidosManuais = []; // Participantes marcados para exclusão (opcional, pode ser dinâmico)
let premiadosOficiaisFixos = []; // Os 6 ganhadores fixos do sorteio oficial, se houver

// --- Configurações do Sorteio ---
const FRUTAS_ANIMAIS_EMOJIS = [
    '🍎', '🍊', '🍌', '🍇', '🦁', '🐘', '🐒', '🦋', '🍓', '🍍',
    '🦊', '🐻', '🦉', '🐠', '🥭', '🍐', '🥝', '🦓', '🦒', '🐅'
];
const SEQUENCE_LENGTH = 5;

let currentConfig = {
    limite_participantes: 10,
    num_winners: 1,
    target_emoji_sequence: ''
};

// `participants` e `sorteioHistory` ainda serão do MongoDB
let participants = []; // Contém todos os participantes com seu status_premio
let sorteioHistory = []; // Histórico completo dos sorteios
let lastDrawTime = null;
let lastWinners = []; // ÚLtimos ganhadores do sorteio principal (trial)

// ADMIN_USER e ADMIN_PASS agora leem de variáveis de ambiente
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123';

// --- Funções Auxiliares ---
function generateRandomEmojiSequence() {
    let sequence = '';
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
        const randomIndex = Math.floor(Math.random() * FRUTAS_ANIMAIS_EMOJIS.length);
        sequence += FRUTAS_ANIMAIS_EMOJIS[randomIndex];
    }
    return sequence;
}

function calculateSimilarityScore(participantSequence, targetSequence) {
    let score = 0;
    // Garante que as sequências são strings e não nulas/indefinidas
    const pSeq = String(participantSequence || '');
    const tSeq = String(targetSequence || '');
    const length = Math.min(pSeq.length, tSeq.length);
    for (let i = 0; i < length; i++) {
        if (pSeq[i] === tSeq[i]) {
            score++;
        }
    }
    return score;
}

// --- Funções de Persistência em Arquivos JSON ---

async function loadJsonFile(filePath) {
    try {
        const data = await readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') { // File not found
            return []; // Return empty array if file doesn't exist yet
        }
        console.error(`Erro ao ler ${filePath}:`, error);
        return [];
    }
}

async function saveJsonFile(filePath, data) {
    try {
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`Erro ao escrever em ${filePath}:`, error);
    }
}

// --- Funções de Persistência no MongoDB ---

async function loadDataFromDb() {
    try {
        const configDoc = await db.collection(COLLECTION_CONFIG).findOne({});
        if (configDoc) {
            currentConfig = configDoc;
            // Se a sequência alvo não existe ou está vazia, gera uma nova
            if (!currentConfig.target_emoji_sequence || currentConfig.target_emoji_sequence.length !== SEQUENCE_LENGTH * 2) { // 5 emojis * 2 chars
                 currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                 await db.collection(COLLECTION_CONFIG).updateOne({}, { $set: { target_emoji_sequence: currentConfig.target_emoji_sequence } }, { upsert: true });
            }
        } else {
            currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
            await db.collection(COLLECTION_CONFIG).insertOne(currentConfig);
        }

        participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();
        sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).sort({ timestamp: -1 }).toArray(); // Ordena para pegar o último

        // --- Atualiza lastDrawTime e lastWinners com base no último sorteio PRINCIPAL do histórico ---
        const lastPrincipalDrawEntry = sorteioHistory.find(entry => entry.tipo_sorteio === 'trial');
        if (lastPrincipalDrawEntry) {
            lastDrawTime = lastPrincipalDrawEntry.timestamp;
            lastWinners = lastPrincipalDrawEntry.winners || [];
        } else {
            lastDrawTime = null;
            lastWinners = [];
        }

        // --- Carregar dados dos arquivos JSON ---
        premiadosExtras = await loadJsonFile(PREMIADOS_EXTRAS_FILE);
        excluidosManuais = await loadJsonFile(EXCLUIDOS_MANUAIS_FILE);
        premiadosOficiaisFixos = await loadJsonFile(PREMIADOS_OFICIAIS_FIXOS_FILE);

        console.log('Dados carregados do MongoDB e arquivos JSON.');
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        // Reset state on major error
        participants = [];
        sorteioHistory = [];
        lastDrawTime = null;
        lastWinners = [];
        premiadosExtras = [];
        excluidosManuais = [];
        // premiadosOficiaisFixos NÃO são resetados aqui se forem "fixos" por definição
        currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
    }
}

async function saveConfigToDb() {
    try {
        await db.collection(COLLECTION_CONFIG).updateOne({}, { $set: currentConfig }, { upsert: true });
    } catch (error) {
        console.error('Erro ao salvar config no MongoDB:', error);
    }
}

// Salva/Atualiza um único participante no DB
async function saveParticipantToDb(participant) {
    try {
        await db.collection(COLLECTION_PARTICIPANTS).updateOne(
            { _id: participant._id },
            { $set: participant },
            { upsert: true }
        );
    } catch (error) {
        console.error('Erro ao salvar participante no MongoDB:', error);
    }
}

// Usada no reset
async function saveAllParticipantsToDb(allParticipants) {
    try {
        await db.collection(COLLECTION_PARTICIPANTS).deleteMany({});
        if (allParticipants.length > 0) {
            await db.collection(COLLECTION_PARTICIPANTS).insertMany(allParticipants);
        }
    } catch (error) {
        console.error('Erro ao salvar todos os participantes no MongoDB:', error);
    }
}

async function addHistoryToDb(entry) {
    try {
        await db.collection(COLLECTION_HISTORY).insertOne(entry);
    } catch (error) {
        console.error('Erro ao adicionar histórico no MongoDB:', error);
    }
}

async function resetSorteioState() {
    participants = [];
    lastWinners = [];
    lastDrawTime = null;
    currentConfig.target_emoji_sequence = generateRandomEmojiSequence(); // Nova sequência alvo

    // --- NOVO: Limpar arquivos JSON também no reset, EXCETO premiadosOficiaisFixos se eles são realmente fixos ---
    premiadosExtras = [];
    excluidosManuais = [];
    // premiadosOficiaisFixos = []; // Se eles são fixos, talvez não queira resetar
    await saveJsonFile(PREMIADOS_EXTRAS_FILE, premiadosExtras);
    await saveJsonFile(EXCLUIDOS_MANUAIS_FILE, excluidosManuais);
    // await saveJsonFile(PREMIADOS_OFICIAIS_FIXOS_FILE, premiadosOficiaisFixos); // Se resetar

    try {
        await db.collection(COLLECTION_PARTICIPANTS).deleteMany({});
        await db.collection(COLLECTION_HISTORY).deleteMany({});
        await db.collection(COLLECTION_CONFIG).updateOne({}, {
            $set: {
                target_emoji_sequence: currentConfig.target_emoji_sequence,
                limite_participantes: 10,
                num_winners: 1
            }
        }, { upsert: true });
        console.log('Sorteio resetado. Nova sequência alvo:', currentConfig.target_emoji_sequence);
    } catch (error) {
        console.error('Erro ao resetar sorteio no MongoDB:', error);
    }
}

// --- Funções de Sorteio (MODIFICADAS e NOVAS) ---

/**
 * Realiza um sorteio genérico com base em uma lista de participantes e um tipo.
 * @param {Array} participantsPool - A lista de participantes elegíveis para este sorteio.
 * @param {string} type - 'trial' (original), 'extra', 'filtered'.
 * @param {number} numWinners - Quantos vencedores escolher.
 * @returns {Object} - Um objeto contendo os vencedores e uma mensagem.
 */
async function performGenericDraw(participantsPool, type, numWinners) {
    if (participantsPool.length === 0) {
        return { winners: [], message: 'Não há participantes elegíveis para este sorteio.' };
    }

    const participantsWithScores = participantsPool.map(p => ({
        ...p,
        score: calculateSimilarityScore(p.emoji_sequence, currentConfig.target_emoji_sequence),
        target_emoji_sequence: currentConfig.target_emoji_sequence // Adiciona a sequência alvo para o histórico
    }));

    participantsWithScores.sort((a, b) => b.score - a.score);

    const winners = participantsWithScores.slice(0, Math.min(numWinners, participantsPool.length));

    // --- NOVO: Atualiza o status de premiação no banco de dados e nos arquivos JSON ---
    for (const winner of winners) {
        // Encontra o participante original pelo _id (necessário para o MongoDB)
        // Convertendo _id para string para comparação consistente
        const participantInDb = participants.find(p => p._id.toString() === winner._id.toString());
        if (participantInDb) {
            if (type === 'trial') {
                participantInDb.status_premio = 'premiado_oficial';
                // Adiciona aos premiados fixos, se ainda não estiver lá
                if (!premiadosOficiaisFixos.some(pf => pf._id === participantInDb._id.toString())) {
                    premiadosOficiaisFixos.push({
                        _id: participantInDb._id.toString(),
                        nome: participantInDb.nome,
                        emoji_sequence: participantInDb.emoji_sequence,
                        score: winner.score,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (type === 'extra' || type === 'filtered') {
                participantInDb.status_premio = 'premiado_extra';
                // Adiciona aos premiados extras
                premiadosExtras.push({
                    _id: participantInDb._id.toString(),
                    nome: participantInDb.nome,
                    emoji_sequence: participantInDb.emoji_sequence,
                    score: winner.score,
                    timestamp: new Date().toISOString(),
                    type: type // Para saber se foi extra ou filtrado
                });
            }
            await saveParticipantToDb(participantInDb); // Salva a alteração no MongoDB
        }
    }
    // Salva os arquivos JSON atualizados
    await saveJsonFile(PREMIADOS_EXTRAS_FILE, premiadosExtras);
    await saveJsonFile(PREMIADOS_OFICIAIS_FIXOS_FILE, premiadosOficiaisFixos);


    // Atualiza o histórico geral do sorteio (MongoDB)
    const newHistoryEntry = {
        timestamp: new Date().toISOString(),
        target_emoji_sequence: currentConfig.target_emoji_sequence,
        winners: winners.map(w => ({
            nome: w.nome,
            emoji_sequence: w.emoji_sequence,
            score: w.score,
            status_premio: (type === 'trial' ? 'premiado_oficial' : 'premiado_extra') // Adiciona o status ao histórico
        })),
        tipo_sorteio: type // NOVO: Adiciona o tipo de sorteio ao histórico
    };
    sorteioHistory.push(newHistoryEntry);
    await addHistoryToDb(newHistoryEntry);

    // `lastDrawTime` e `lastWinners` devem refletir apenas o último sorteio PRINCIPAL (trial)
    if (type === 'trial') {
        lastDrawTime = newHistoryEntry.timestamp;
        lastWinners = winners;
    }

    return { winners: winners, message: 'Sorteio realizado com sucesso.' };
}


// --- Conexão com o MongoDB e Início do Servidor ---
async function startServer() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('Conectado ao MongoDB!');

        await loadDataFromDb(); // Carrega os dados existentes ao iniciar o servidor

        // --- Configuração do Express ---
        app.use(express.static(path.join(__dirname, 'public')));

        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // --- Socket.IO Connection Handling ---
        io.on('connection', (socket) => {
            console.log(`Usuário conectado: ${socket.id}`);

            // Envia os dados iniciais para o cliente recém-conectado
            socket.emit('initialData', {
                config: currentConfig,
                participantes: participants.map(p => ({
                    id: p._id.toString(), // Envia o ID como string para o frontend
                    nome: p.nome,
                    emoji_sequence: p.emoji_sequence,
                    status_premio: p.status_premio // Inclui o status de premiação
                })),
                lastDrawTime: lastDrawTime, // Último ganhador do sorteio principal
                lastWinners: lastWinners,   // Últimos ganhadores do sorteio principal
                premiadosExtras: premiadosExtras, // Vencedores de sorteios extras/filtrados
                premiadosOficiaisFixos: premiadosOficiaisFixos, // Os 6 ganhadores fixos
                history: sorteioHistory,
                targetSequence: currentConfig.target_emoji_sequence
            });

            // Evento: Adicionar Participante (pelo cliente normal)
            socket.on('addParticipant', async (data) => {
                const { nome } = data;

                if (!nome || nome.trim() === '') {
                    socket.emit('participantError', 'O nome não pode estar vazio.');
                    return;
                }

                if (participants.length >= currentConfig.limite_participantes) {
                    socket.emit('participantError', 'Limite de participantes atingido. Aguarde o sorteio.');
                    return;
                }

                // Verifica se o nome já existe entre os participantes ativos
                if (participants.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
                    socket.emit('participantError', `O nome "${nome}" já está participando.`);
                    return;
                }

                const newParticipant = {
                    nome: nome.trim(),
                    emoji_sequence: generateRandomEmojiSequence(),
                    status_premio: undefined // Novo campo para rastrear se foi premiado
                };

                try {
                    // Inserir no MongoDB para obter o _id
                    const result = await db.collection(COLLECTION_PARTICIPANTS).insertOne(newParticipant);
                    newParticipant._id = result.insertedId; // Atribui o _id gerado pelo MongoDB

                    participants.push(newParticipant);
                    // Não precisa chamar saveParticipantsToDb aqui, pois já foi inserido

                    console.log(`Participante adicionado: ${newParticipant.nome} com ${newParticipant.emoji_sequence} (ID: ${newParticipant._id})`);

                    io.emit('participantAdded', {
                        nome: newParticipant.nome,
                        emoji_sequence: newParticipant.emoji_sequence,
                        // --- MODIFICADO: Envia participantes com status de prêmio ---
                        allParticipants: participants.map(p => ({
                            id: p._id.toString(),
                            nome: p.nome,
                            emoji_sequence: p.emoji_sequence,
                            status_premio: p.status_premio
                        })),
                        config: currentConfig,
                        lastDrawTime: lastDrawTime,
                        lastWinners: lastWinners,
                        premiadosExtras: premiadosExtras,
                        premiadosOficiaisFixos: premiadosOficiaisFixos,
                        targetSequence: currentConfig.target_emoji_sequence
                    });
                } catch (error) {
                    console.error('Erro ao adicionar participante:', error);
                    socket.emit('participantError', 'Erro ao adicionar participante. Tente novamente.');
                }
            });

            // Evento: Realizar Sorteio Principal
            socket.on('performDraw', async ({ type }) => {
                // Aqui você pode adicionar autenticação de admin se ainda não tiver feito
                // if (!socket.isAdmin) { socket.emit('drawError', 'Apenas administradores podem realizar sorteios.'); return; }

                if (type !== 'trial') { // Garante que este evento é só para 'trial'
                    socket.emit('drawError', 'Tipo de sorteio inválido para este evento.');
                    return;
                }

                let eligibleParticipants = participants.filter(p =>
                    p.status_premio !== 'premiado_oficial' && p.status_premio !== 'premiado_extra'
                );

                if (eligibleParticipants.length === 0) {
                    socket.emit('drawError', 'Todos os participantes já foram premiados. Nenhum elegível para o sorteio Oficial.');
                    return;
                }

                const { winners, message } = await performGenericDraw(eligibleParticipants, type, currentConfig.num_winners);

                if (winners.length === 0) {
                    socket.emit('drawError', message);
                    return;
                }

                // Atualiza a lista de participantes globais (com status de prêmio)
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();
                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).sort({ timestamp: -1 }).toArray(); // Recarrega histórico

                io.emit('drawResult', {
                    winners: winners.map(w => ({ ...w, id: w._id.toString() })),
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime, // Já atualizado em performGenericDraw se type === 'trial'
                    lastWinners: lastWinners,   // Já atualizado em performGenericDraw se type === 'trial'
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence,
                    type: type // Envia o tipo para o frontend
                });

                // Reinicia a sequência alvo após o sorteio principal
                currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                await saveConfigToDb();

                // Emite a atualização da configuração para todos os clientes, especialmente a nova sequência alvo
                io.emit('configUpdated', {
                    config: currentConfig,
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    targetSequence: currentConfig.target_emoji_sequence
                });

                io.emit('updateTargetEmojis', currentConfig.target_emoji_sequence);

                console.log(`Sorteio Oficial Realizado! Ganhadores:`, winners.map(w => w.nome));
            });

            // NOVO: Evento: Realizar Sorteio Extra
            socket.on('performExtraDraw', async ({ type }) => {
                 // if (!socket.isAdmin) { socket.emit('drawError', 'Apenas administradores podem realizar sorteios extras.'); return; }

                if (type !== 'extra') { // Garante que este evento é só para 'extra'
                    socket.emit('drawError', 'Tipo de sorteio inválido para este evento.');
                    return;
                }

                // Sorteio Extra: apenas participantes que NÃO foram premiados (oficial ou extra)
                let eligibleParticipants = participants.filter(p =>
                    p.status_premio !== 'premiado_oficial' &&
                    p.status_premio !== 'premiado_extra'
                );

                if (eligibleParticipants.length === 0) {
                    socket.emit('drawError', 'Não há participantes não premiados para o sorteio extra.');
                    return;
                }

                const { winners, message } = await performGenericDraw(eligibleParticipants, type, currentConfig.num_winners);

                if (winners.length === 0) {
                    socket.emit('drawError', message);
                    return;
                }

                // Atualiza a lista de participantes globais após o sorteio
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();
                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).sort({ timestamp: -1 }).toArray(); // Recarrega histórico

                io.emit('drawResult', {
                    winners: winners.map(w => ({ ...w, id: w._id.toString() })),
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence,
                    type: type // Envia o tipo para o frontend
                });

                // Você pode ou não querer gerar uma nova sequência alvo após um sorteio extra.
                // Se a ideia é que sorteios extras sejam "extras" no mesmo ciclo de sorteio oficial,
                // talvez não queira resetar a sequência alvo. Vou manter como "não resetar" para o extra.
                // currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                // await saveConfigToDb();

                // Emite a atualização da configuração para todos os clientes (se mudou algo, como num_winners)
                io.emit('configUpdated', {
                    config: currentConfig,
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    targetSequence: currentConfig.target_emoji_sequence
                });

                console.log('Sorteio Extra Realizado! Ganhadores:', winners.map(w => w.nome));
            });


            // Evento para Sorteio Filtrado (apenas admin)
            socket.on('performFilteredDraw', async (data) => {
                // if (!socket.isAdmin) { socket.emit('filteredDrawError', 'Apenas administradores podem realizar sorteios filtrados.'); return; }
                const { excludedIds } = data; // IDs dos participantes a serem excluídos (strings do frontend)

                // Converter IDs para ObjectId para comparação com o _id do MongoDB
                const excludedObjectIds = excludedIds.map(id => new ObjectId(id));

                let eligibleParticipants = participants.filter(p =>
                    !excludedObjectIds.some(excludedId => excludedId.equals(p._id)) && // Exclui os selecionados
                    p.status_premio !== 'premiado_oficial' && // E aqueles já oficiais
                    p.status_premio !== 'premiado_extra' // E aqueles já extras
                );

                if (eligibleParticipants.length === 0) {
                    socket.emit('drawError', 'Não há participantes elegíveis para o sorteio filtrado após aplicar as exclusões.');
                    return;
                }

                const { winners, message } = await performGenericDraw(eligibleParticipants, 'filtered', currentConfig.num_winners);

                if (winners.length === 0) {
                    socket.emit('drawError', message);
                    return;
                }

                // Atualiza a lista de participantes globais após o sorteio
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();
                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).sort({ timestamp: -1 }).toArray(); // Recarrega histórico

                io.emit('drawResult', { // Usando o mesmo evento 'drawResult' para unificar
                    winners: winners.map(w => ({ ...w, id: w._id.toString() })),
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime, // Não será afetado por sorteio filtrado
                    lastWinners: lastWinners,   // Não será afetado por sorteio filtrado
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence,
                    type: 'filtered' // Envia o tipo para o frontend
                });

                // Você pode ou não querer gerar uma nova sequência alvo após um sorteio filtrado.
                // Por ser um sorteio "extra", vou manter o comportamento de não gerar nova sequência alvo.
                // currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                // await saveConfigToDb();

                io.emit('configUpdated', { // Emite a atualização da configuração para todos os clientes
                    config: currentConfig,
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    targetSequence: currentConfig.target_emoji_sequence
                });

                console.log('Sorteio Filtrado Realizado! Ganhadores:', winners.map(w => w.nome));
            });


            // Evento: Login do Administrador
            socket.on('adminLogin', async (credentials) => {
                const { user, pass } = credentials;
                if (user === ADMIN_USER && pass === ADMIN_PASS) {
                    // socket.isAdmin = true; // Você pode adicionar uma flag na sessão do socket
                    socket.emit('adminLoginSuccess', {
                        config: currentConfig,
                        // --- MODIFICADO: Envia participantes com status de prêmio ---
                        participantes: participants.map(p => ({
                            id: p._id.toString(),
                            nome: p.nome,
                            emoji_sequence: p.emoji_sequence,
                            status_premio: p.status_premio
                        })),
                        lastDrawTime: lastDrawTime,
                        lastWinners: lastWinners,
                        premiadosExtras: premiadosExtras,
                        premiadosOficiaisFixos: premiadosOficiaisFixos,
                        targetSequence: currentConfig.target_emoji_sequence
                    });
                    console.log(`Administrador ${socket.id} logado.`);
                } else {
                    socket.emit('adminLoginFailed', 'Credenciais inválidas.');
                }
            });

            // Evento para o admin solicitar a lista completa de participantes
            socket.on('requestAdminParticipants', async () => {
                // if (!socket.isAdmin) { socket.emit('adminError', 'Apenas administradores podem acessar esta função.'); return; }
                const allParticipantsFromDb = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();
                socket.emit('adminParticipantsList', allParticipantsFromDb.map(p => ({
                    id: p._id.toString(), // Garante que o ID é string
                    nome: p.nome,
                    emoji_sequence: p.emoji_sequence,
                    status_premio: p.status_premio
                })));
                console.log(`Admin ${socket.id} solicitou lista de participantes para gerenciamento.`);
            });


            // Evento: Atualizar Configurações (apenas admin)
            socket.on('updateConfig', async (newConfig) => {
                // if (!socket.isAdmin) { socket.emit('configError', 'Apenas administradores podem atualizar configurações.'); return; }
                const { limite_participantes, num_winners } = newConfig;

                if (isNaN(limite_participantes) || limite_participantes < 1 || isNaN(num_winners) || num_winners < 1) {
                    socket.emit('configError', 'Valores inválidos para limite ou número de premiados.');
                    return;
                }

                if (num_winners > limite_participantes) {
                    socket.emit('configError', 'O número de premiados não pode ser maior que o limite de participantes.');
                    return;
                }

                currentConfig.limite_participantes = limite_participantes;
                currentConfig.num_winners = num_winners;
                await saveConfigToDb();

                io.emit('configUpdated', {
                    config: currentConfig,
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    targetSequence: currentConfig.target_emoji_sequence
                });
                console.log('Configurações atualizadas:', currentConfig);
            });

            // Evento: Resetar Sorteio (apenas admin)
            socket.on('resetSorteio', async () => {
                // if (!socket.isAdmin) { socket.emit('resetError', 'Apenas administradores podem resetar o sorteio.'); return; }
                await resetSorteioState();

                // Recarrega o histórico e participantes para garantir que estão limpos
                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).sort({ timestamp: -1 }).toArray();
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();

                io.emit('sorteioReset', {
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence
                });
                console.log('Sorteio totalmente resetado. Nova rodada iniciada.');
            });

            // Evento para Admin Adicionar Participante Manualmente
            socket.on('adminAddParticipant', async ({ nome, emojiSequence }) => {
                // if (!socket.isAdmin) { socket.emit('participantError', 'Apenas administradores podem adicionar participantes.'); return; }

                if (!nome || nome.trim() === '' || !emojiSequence || emojiSequence.trim() === '') {
                    socket.emit('adminMessage', { type: 'error', text: 'Nome e sequência de emoji não podem estar vazios.' });
                    return;
                }

                if (participants.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
                    socket.emit('adminMessage', { type: 'error', text: `O nome "${nome}" já está participando.` });
                    return;
                }
                 // Validação para 5 emojis (10 caracteres)
                if (emojiSequence.length !== SEQUENCE_LENGTH * 2) {
                    socket.emit('adminMessage', { type: 'error', text: `A sequência de emojis deve ter ${SEQUENCE_LENGTH} emojis.` });
                    return;
                }


                const newParticipant = {
                    nome: nome.trim(),
                    emoji_sequence: emojiSequence.trim(),
                    status_premio: undefined
                };

                try {
                    const result = await db.collection(COLLECTION_PARTICIPANTS).insertOne(newParticipant);
                    newParticipant._id = result.insertedId;
                    participants.push(newParticipant);

                    console.log(`Admin adicionou participante: ${newParticipant.nome} com ${newParticipant.emoji_sequence}`);

                    io.emit('participantAddedByAdmin', {
                        success: true,
                        participante: { ...newParticipant, id: newParticipant._id.toString() },
                        allParticipants: participants.map(p => ({
                            id: p._id.toString(),
                            nome: p.nome,
                            emoji_sequence: p.emoji_sequence,
                            status_premio: p.status_premio
                        })),
                        config: currentConfig,
                        lastDrawTime: lastDrawTime,
                        lastWinners: lastWinners,
                        premiadosExtras: premiadosExtras,
                        premiadosOficiaisFixos: premiadosOficiaisFixos,
                        history: sorteioHistory
                    });
                     socket.emit('adminMessage', { type: 'success', text: `Participante "${nome}" adicionado com sucesso!` });
                } catch (error) {
                    console.error('Erro ao adicionar participante pelo admin:', error);
                    socket.emit('adminMessage', { type: 'error', text: 'Erro ao adicionar participante. Tente novamente.' });
                }
            });

            // NOVO: Evento para Admin Definir Emoji Alvo
            socket.on('setTargetEmojis', async (targetEmojis) => {
                // if (!socket.isAdmin) { socket.emit('adminMessage', { type: 'error', text: 'Apenas administradores podem definir a sequência alvo.' }); return; }

                if (!targetEmojis || targetEmojis.trim() === '' || targetEmojis.length !== SEQUENCE_LENGTH * 2) {
                    socket.emit('adminMessage', { type: 'error', text: `A sequência alvo deve ter ${SEQUENCE_LENGTH} emojis.` });
                    return;
                }

                currentConfig.target_emoji_sequence = targetEmojis.trim();
                await saveConfigToDb();

                io.emit('updateTargetEmojis', currentConfig.target_emoji_sequence);
                io.emit('adminMessage', { type: 'success', text: 'Sequência alvo atualizada com sucesso!' });
                console.log('Sequência alvo atualizada pelo admin:', currentConfig.target_emoji_sequence);
            });

            // NOVO: Evento para Admin Carregar Participantes via JSON
            socket.on('addJsonParticipants', async (jsonParticipants) => {
                // if (!socket.isAdmin) { socket.emit('adminMessage', { type: 'error', text: 'Apenas administradores podem carregar participantes via JSON.' }); return; }

                if (!Array.isArray(jsonParticipants)) {
                    socket.emit('adminMessage', { type: 'error', text: 'JSON inválido. Espera-se um array de participantes.' });
                    return;
                }

                let addedCount = 0;
                for (const pData of jsonParticipants) {
                    const { nome, emojiSequence } = pData;

                    if (!nome || nome.trim() === '' || !emojiSequence || emojiSequence.trim() === '') {
                        console.warn(`Ignorando participante inválido no JSON: ${JSON.stringify(pData)}`);
                        continue;
                    }
                    // Validação para 5 emojis (10 caracteres)
                    if (emojiSequence.length !== SEQUENCE_LENGTH * 2) {
                        console.warn(`Ignorando participante "${nome}" devido à sequência de emoji inválida: ${emojiSequence}. Deve ter ${SEQUENCE_LENGTH} emojis.`);
                        continue;
                    }

                    // Verifica se o nome já existe entre os participantes ativos
                    if (participants.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
                        console.warn(`Ignorando participante "${nome}" do JSON, pois já existe.`);
                        continue;
                    }

                    const newParticipant = {
                        nome: nome.trim(),
                        emoji_sequence: emojiSequence.trim(),
                        status_premio: undefined
                    };

                    try {
                        const result = await db.collection(COLLECTION_PARTICIPANTS).insertOne(newParticipant);
                        newParticipant._id = result.insertedId;
                        participants.push(newParticipant);
                        addedCount++;
                    } catch (error) {
                        console.error(`Erro ao adicionar participante "${nome}" do JSON:`, error);
                    }
                }

                io.emit('participantAddedByAdmin', { // Reutilizando este evento, pode ser customizado
                    success: true,
                    message: `${addedCount} participantes carregados via JSON.`,
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    lastWinners: lastWinners,
                    premiadosExtras: premiadosExtras,
                    premiadosOficiaisFixos: premiadosOficiaisFixos,
                    history: sorteioHistory
                });
                socket.emit('adminMessage', { type: 'success', text: `${addedCount} participantes carregados via JSON.` });
                console.log(`${addedCount} participantes carregados via JSON pelo admin.`);
            });


            socket.on('disconnect', () => {
                console.log(`Usuário desconectado: ${socket.id}`);
            });
        });

        // Inicia o servidor
        server.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
            console.log(`Acesse: http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error('Falha ao conectar ao MongoDB ou iniciar o servidor:', error);
        process.exit(1); // Encerra o processo se não conseguir conectar ao DB
    }
}

startServer();