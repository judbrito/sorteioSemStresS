// server.js

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoClient } = require('mongodb'); // Importa o cliente MongoDB

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Configurações do Banco de Dados ---
// Use uma variável de ambiente para a URI de conexão (MUITO IMPORTANTE PARA SEGURANÇA!)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/SorteioDB?retryWrites=true&w=majority';
const DB_NAME = 'SorteioDB'; // Nome do seu banco de dados
const COLLECTION_PARTICIPANTS = 'participants';
const COLLECTION_HISTORY = 'sorteioHistory';
const COLLECTION_CONFIG = 'config';

let db; // Variável para armazenar a conexão com o banco de dados

// --- Configurações do Sorteio ---
const FRUTAS_ANIMAIS_EMOJIS = [
    '🍎', '🍊', '🍌', '🍇', '🦁', '🐘', '🐒', '🦋', '🍓', '🍍',
    '🦊', '🐻', '🦉', '🐠', '🥭', '🍐', '🥝', '🦓', '🦒', '🐅'
];
const SEQUENCE_LENGTH = 5;

let currentConfig = {
    limite_participantes: 10,
    num_winners: 1,
    target_emoji_sequence: '' // Será gerada ou carregada do DB
};

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

// --- Funções de Persistência no MongoDB ---

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

        console.log('Dados carregados do MongoDB.');
    } catch (error) {
        console.error('Erro ao carregar dados do MongoDB:', error);
        participants = [];
        sorteioHistory = [];
        lastDrawTime = null;
        lastWinners = [];
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

async function saveParticipantsToDb() {
    try {
        await db.collection(COLLECTION_PARTICIPANTS).deleteMany({});
        if (participants.length > 0) {
            await db.collection(COLLECTION_PARTICIPANTS).insertMany(participants);
        }
    } catch (error) {
        console.error('Erro ao salvar participantes no MongoDB:', error);
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

    try {
        await db.collection(COLLECTION_PARTICIPANTS).deleteMany({});
        await db.collection(COLLECTION_HISTORY).deleteMany({});
        await db.collection(COLLECTION_CONFIG).updateOne({}, { $set: {
            target_emoji_sequence: currentConfig.target_emoji_sequence,
            limite_participantes: 10,
            num_winners: 1
        }}, { upsert: true });
        console.log('Sorteio resetado. Nova sequência alvo:', currentConfig.target_emoji_sequence);
    } catch (error) {
        console.error('Erro ao resetar sorteio no MongoDB:', error);
    }
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
            // Inclui a sequência alvo para todos os usuários
            socket.emit('initialData', {
                config: currentConfig,
                participantes: participants,
                lastDrawTime: lastDrawTime,
                lastWinners: lastWinners,
                history: sorteioHistory,
                targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
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
                    id: socket.id,
                    nome: nome,
                    emoji_sequence: generateRandomEmojiSequence()
                };
                participants.push(newParticipant);
                await saveParticipantsToDb();

                console.log(`Participante adicionado: ${newParticipant.nome} com ${newParticipant.emoji_sequence}`);

                io.emit('participantAdded', {
                    nome: newParticipant.nome,
                    emoji_sequence: newParticipant.emoji_sequence,
                    allParticipants: participants,
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
                });
            });

            // Evento: Realizar Sorteio
            socket.on('performDraw', async () => {
                // Removida a regra de número mínimo de participantes para o sorteio.
                // Agora, o sorteio pode ser realizado com qualquer número de participantes (até 0, se desejado).
                // A validação de "Não há participantes" ainda é útil para evitar sorteio vazio.
                if (participants.length === 0) {
                    socket.emit('drawError', 'Não há participantes para sortear.');
                    return;
                }

                const participantsWithScores = participants.map(p => ({
                    ...p,
                    score: calculateSimilarityScore(p.emoji_sequence, currentConfig.target_emoji_sequence),
                    target_emoji_sequence: currentConfig.target_emoji_sequence
                }));

                participantsWithScores.sort((a, b) => b.score - a.score);

                // Garante que o número de ganhadores não exceda o número de participantes
                lastWinners = participantsWithScores.slice(0, Math.min(currentConfig.num_winners, participants.length));

                const newHistoryEntry = {
                    timestamp: new Date().toISOString(),
                    target_emoji_sequence: currentConfig.target_emoji_sequence,
                    winners: lastWinners.map(w => ({ nome: w.nome, emoji_sequence: w.emoji_sequence, score: w.score }))
                };
                sorteioHistory.push(newHistoryEntry);
                await addHistoryToDb(newHistoryEntry);
                lastDrawTime = newHistoryEntry.timestamp;

                console.log('Sorteio realizado. Ganhadores:', lastWinners.map(w => w.nome));

                io.emit('drawResult', {
                    winners: lastWinners,
                    allParticipants: [],
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
                });

                // Prepara para a próxima rodada (limpa participantes e gera nova sequência alvo)
                participants = [];
                currentConfig.target_emoji_sequence = generateRandomEmojiSequence();
                await saveParticipantsToDb();
                await saveConfigToDb();

                io.emit('configUpdated', {
                    config: currentConfig,
                    allParticipants: participants,
                    lastDrawTime: lastDrawTime,
                    targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
                });
            });

            // Evento: Login do Administrador
            socket.on('adminLogin', (credentials) => {
                const { user, pass } = credentials;
                if (user === ADMIN_USER && pass === ADMIN_PASS) {
                    socket.emit('adminLoginSuccess', {
                        config: currentConfig,
                        participantes: participants,
                        lastDrawTime: lastDrawTime,
                        targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
                    });
                    console.log(`Administrador ${socket.id} logado.`);
                } else {
                    socket.emit('adminLoginFailed', 'Credenciais inválidas.');
                }
            });

            // Evento: Atualizar Configurações (apenas admin)
            socket.on('updateConfig', async (newConfig) => {
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
                    allParticipants: participants,
                    lastDrawTime: lastDrawTime,
                    targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
                });
                console.log('Configurações atualizadas:', currentConfig);
            });

            // Evento: Resetar Sorteio (apenas admin)
            socket.on('resetSorteio', async () => {
                await resetSorteioState();

                sorteioHistory = await db.collection(COLLECTION_HISTORY).find({}).toArray();

                io.emit('sorteioReset', {
                    allParticipants: participants,
                    config: currentConfig,
                    lastDrawTime: lastDrawTime,
                    history: sorteioHistory,
                    targetSequence: currentConfig.target_emoji_sequence // **NOVO: Envia a sequência alvo**
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