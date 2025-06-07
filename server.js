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
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/SorteioDB?retryWrites=true&w=majority';
const DB_NAME = 'SorteioDB';
const COLLECTION_PARTICIPANTS = 'participants';
const COLLECTION_HISTORY = 'sorteioHistory';
const COLLECTION_CONFIG = 'config';

let db; // Variável para armazenar a conexão com o banco de dados

// --- NOVO: Caminhos para arquivos JSON de persistência secundária ---
const DATA_DIR = path.join(__dirname, 'data'); // Pasta para os arquivos JSON
const PREMIADOS_EXTRAS_FILE = path.join(DATA_DIR, 'premiados_extras.json');
const EXCLUIDOS_MANUAIS_FILE = path.join(DATA_DIR, 'excluidos_manuais.json');
const PREMIADOS_OFICIAIS_FIXOS_FILE = path.join(DATA_DIR, 'premiados_oficiais_fixos.json'); // NOVO: Para os 6 fixos

// Garante que a pasta 'data' existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// --- NOVO: Variáveis para dados persistidos em JSON ---
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
let participants = [];
let sorteioHistory = [];
let lastDrawTime = null;
let lastWinners = [];

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
    const length = Math.min(participantSequence.length, targetSequence.length);
    for (let i = 0; i < length; i++) {
        if (participantSequence[i] === targetSequence[i]) {
            score++;
        }
    }
    return score;
}

// --- Funções de Persistência em Arquivos JSON (NOVO) ---

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

// --- Funções de Persistência no MongoDB (Modificadas e Novas) ---

async function loadDataFromDb() {
    try {
        const configDoc = await db.collection(COLLECTION_CONFIG).findOne({});
        if (configDoc) {
            currentConfig = configDoc;
            if (!currentConfig.target_emoji_sequence) {
                currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                await db.collection(COLLECTION_CONFIG).updateOne({}, { $set: { target_emoji_sequence: currentConfig.target_emoji_sequence } }, { upsert: true });
            }
        } else {
            currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
            await db.collection(COLLECTION_CONFIG).insertOne(currentConfig);
        }

        // --- MODIFICADO: Carregar participantes do DB e fundir com status de prêmio ---
        // Participantes agora podem ter um `status_premio` no BD: 'premiado_oficial', 'premiado_extra', ou undefined
        participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();

        sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).toArray();

        const lastDrawEntry = sorteioHistory.length > 0 ? sorteioHistory[sorteioHistory.length - 1] : null;
        if (lastDrawEntry) {
            lastDrawTime = lastDrawEntry.timestamp;
            lastWinners = lastDrawEntry.winners || [];
        } else {
            lastDrawTime = null;
            lastWinners = [];
        }

        // --- NOVO: Carregar dados dos arquivos JSON ---
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
        premiadosOficiaisFixos = [];
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

// MODIFICADO: A função de salvar participantes agora pode atualizar um único participante
// Útil para atualizar o status_premio
async function saveParticipantToDb(participant) {
    try {
        await db.collection(COLLECTION_PARTICIPANTS).updateOne(
            { _id: participant._id }, // Usa _id do MongoDB para identificar
            { $set: participant },
            { upsert: true }
        );
    } catch (error) {
        console.error('Erro ao salvar participante no MongoDB:', error);
    }
}

// MODIFICADO: A função de salvar todos os participantes (usada no reset)
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

    // --- NOVO: Limpar arquivos JSON também no reset ---
    premiadosExtras = [];
    excluidosManuais = []; // Manter os fixos pode ser uma decisão
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
 * @returns {Array} - Os vencedores.
 */
async function performGenericDraw(participantsPool, type, numWinners) {
    if (participantsPool.length === 0) {
        return { winners: [], message: 'Não há participantes elegíveis para este sorteio.' };
    }

    const participantsWithScores = participantsPool.map(p => ({
        ...p,
        score: calculateSimilarityScore(p.emoji_sequence, currentConfig.target_emoji_sequence),
        target_emoji_sequence: currentConfig.target_emoji_sequence
    }));

    participantsWithScores.sort((a, b) => b.score - a.score);

    const winners = participantsWithScores.slice(0, Math.min(numWinners, participantsPool.length));

    // --- NOVO: Atualiza o status de premiação no banco de dados e nos arquivos JSON ---
    for (const winner of winners) {
        // Encontra o participante original pelo _id (necessário para o MongoDB)
        const participantInDb = participants.find(p => p._id.toString() === winner._id.toString());
        if (participantInDb) {
            participantInDb.status_premio = (type === 'trial' ? 'premiado_oficial' : 'premiado_extra'); // Define o status
            await saveParticipantToDb(participantInDb); // Salva a alteração no MongoDB

            // Se for sorteio extra, adiciona aos premiados extras no JSON
            if (type === 'extra' || type === 'filtered') { // Filtrado também é um tipo de 'extra'
                premiadosExtras.push({
                    _id: participantInDb._id.toString(), // Salva o ID como string
                    nome: participantInDb.nome,
                    emoji_sequence: participantInDb.emoji_sequence,
                    score: winner.score,
                    timestamp: new Date().toISOString(),
                    type: type // Para saber se foi extra ou filtrado
                });
            } else if (type === 'trial') { // Se for sorteio oficial (trial)
                premiadosOficiaisFixos.push({ // Adiciona aos fixos
                    _id: participantInDb._id.toString(),
                    nome: participantInDb.nome,
                    emoji_sequence: participantInDb.emoji_sequence,
                    score: winner.score,
                    timestamp: new Date().toISOString()
                });
            }
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

    lastDrawTime = newHistoryEntry.timestamp;
    lastWinners = winners;

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
                // --- MODIFICADO: Envia participantes com status de prêmio ---
                participantes: participants.map(p => ({
                    id: p._id.toString(), // Envia o ID como string para o frontend
                    nome: p.nome,
                    emoji_sequence: p.emoji_sequence,
                    status_premio: p.status_premio // Inclui o status de premiação
                })),
                lastDrawTime: lastDrawTime,
                lastWinners: lastWinners,
                history: sorteioHistory,
                targetSequence: currentConfig.target_emoji_sequence
            });

            // Evento: Adicionar Participante
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

                if (participants.some(p => p.nome === nome)) {
                    socket.emit('participantError', `O nome "${nome}" já está participando.`);
                    return;
                }

                const newParticipant = {
                    nome: nome,
                    emoji_sequence: generateRandomEmojiSequence(),
                    status_premio: undefined // Novo campo para rastrear se foi premiado
                };

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
                    targetSequence: currentConfig.target_emoji_sequence
                });
            });

            // MODIFICADO: Evento: Realizar Sorteio (agora aceita um tipo)
            socket.on('performDraw', async ({ type }) => {
                // Aqui você pode adicionar autenticação de admin se ainda não tiver feito
                // if (!socket.isAdmin) { socket.emit('drawError', 'Apenas administradores podem realizar sorteios.'); return; }

                if (!['trial', 'extra'].includes(type)) {
                    socket.emit('drawError', 'Tipo de sorteio inválido.');
                    return;
                }

                let eligibleParticipants = [];
                let drawMessage = '';

                if (type === 'trial') {
                    // Sorteio Trial (Original): usa todos os participantes ativos
                    if (participants.length === 0) {
                        socket.emit('drawError', 'Não há participantes para o sorteio Trial.');
                        return;
                    }
                    eligibleParticipants = participants.filter(p => p.status_premio !== 'premiado_oficial' && p.status_premio !== 'premiado_extra'); // Não premiados
                    if (eligibleParticipants.length === 0) {
                        socket.emit('drawError', 'Todos os participantes já foram premiados em sorteios oficiais ou extras. Nenhum elegível para o sorteio Trial.');
                        return;
                    }
                    drawMessage = 'Sorteio Trial Realizado!';
                } else if (type === 'extra') {
                    // Sorteio Extra: apenas participantes que NÃO foram premiados (oficial ou extra)
                    eligibleParticipants = participants.filter(p =>
                        p.status_premio !== 'premiado_oficial' &&
                        p.status_premio !== 'premiado_extra' &&
                        !premiadosOficiaisFixos.some(pf => pf._id === p._id.toString()) // Garante que não são os 6 fixos
                    );

                    if (eligibleParticipants.length === 0) {
                        socket.emit('extraDrawError', 'Não há participantes não premiados para o sorteio extra.');
                        return;
                    }
                    drawMessage = 'Sorteio Extra Realizado!';
                }

                const { winners, message } = await performGenericDraw(eligibleParticipants, type, currentConfig.num_winners);

                if (winners.length === 0) {
                    socket.emit('drawError', message);
                    return;
                }

                // Atualiza a lista de participantes globais (com status de prêmio)
                // Isso é essencial para o frontend e para outros sorteios
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();

                io.emit('drawResult', {
                    winners: winners.map(w => ({ ...w, id: w._id.toString() })), // Envia ID como string
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence,
                    type: type // Envia o tipo para o frontend
                });

                // Reinicia a sequência alvo apenas para o sorteio 'trial' (se desejar)
                // Se o sorteio extra não limpa a lista e não gera nova sequência alvo,
                // remova as linhas abaixo, ou adapte para sua lógica.
                // Aqui vou manter a lógica de gerar nova sequência alvo após qualquer sorteio
                // que mude os ganhadores do pool principal.
                currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
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
                    targetSequence: currentConfig.target_emoji_sequence
                });

                console.log(`${drawMessage} Ganhadores:`, winners.map(w => w.nome));
            });

            // --- NOVO: Evento para Sorteio Filtrado (apenas admin) ---
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
                    socket.emit('filteredDrawError', 'Não há participantes elegíveis para o sorteio filtrado após aplicar as exclusões.');
                    return;
                }

                const { winners, message } = await performGenericDraw(eligibleParticipants, 'filtered', currentConfig.num_winners);

                if (winners.length === 0) {
                    socket.emit('filteredDrawError', message);
                    return;
                }

                // Atualiza a lista de participantes globais após o sorteio
                participants = await db.collection(COLLECTION_PARTICIPANTS).find({}).toArray();

                io.emit('drawFilteredResult', {
                    winners: winners.map(w => ({ ...w, id: w._id.toString() })),
                    allParticipants: participants.map(p => ({
                        id: p._id.toString(),
                        nome: p.nome,
                        emoji_sequence: p.emoji_sequence,
                        status_premio: p.status_premio
                    })),
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence,
                    type: 'filtered'
                });

                // Você pode ou não querer gerar uma nova sequência alvo após um sorteio filtrado.
                // Se a ideia é que sorteios filtrados sejam "extras" no mesmo ciclo de sorteio oficial,
                // talvez não queira resetar a sequência alvo ou a lista de participantes.
                // Por agora, vou manter a lógica de gerar nova sequência após qualquer sorteio que modifique o pool.
                currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
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
                        targetSequence: currentConfig.target_emoji_sequence
                    });
                    console.log(`Administrador ${socket.id} logado.`);
                } else {
                    socket.emit('adminLoginFailed', 'Credenciais inválidas.');
                }
            });

            // --- NOVO: Evento para o admin solicitar a lista completa de participantes ---
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
                    targetSequence: currentConfig.target_emoji_sequence
                });
                console.log('Configurações atualizadas:', currentConfig);
            });

            // Evento: Resetar Sorteio (apenas admin)
            socket.on('resetSorteio', async () => {
                // if (!socket.isAdmin) { socket.emit('resetError', 'Apenas administradores podem resetar o sorteio.'); return; }
                await resetSorteioState();

                // Recarrega o histórico e participantes para garantir que estão limpos
                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).toArray();
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
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence
                });
                console.log('Sorteio totalmente resetado. Nova rodada iniciada.');
            });

            socket.on('disconnect', () => {
                console.log(`Usuário desconectado: ${socket.id}`);
            });
        });

        // Inicia o servidor HTTP após a conexão bem-sucedida com o banco de dados
        server.listen(PORT, () => {
            console.log(`Servidor rodando em http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error('Falha ao conectar ao MongoDB ou iniciar o servidor:', error);
        process.exit(1);
    }
}

// Inicia todo o processo da aplicação
startServer();
