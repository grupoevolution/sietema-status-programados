const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const app = express();

// ============ CONFIGURAÇÕES ============
const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL || 'https://evo.flowzap.fun';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'SUA_API_KEY_AQUI';
const PORT = process.env.PORT || 3001;
const SCHEDULE_FILE = path.join(__dirname, 'data', 'status-schedule.json');
const LOGS_FILE = path.join(__dirname, 'data', 'status-logs.json');

// Instâncias Evolution
const INSTANCES = ['GABY01', 'GABY02', 'GABY03', 'GABY04', 'GABY05', 'GABY06', 'GABY07', 'GABY08', 'GABY09'];

// ============ TIMEZONE BRASÍLIA ============
process.env.TZ = 'America/Sao_Paulo';

// ============ ARMAZENAMENTO EM MEMÓRIA ============
let statusSchedule = [];
let logs = [];
let isSystemActive = true;
let currentCycleStartDate = null;

// ============ MIDDLEWARES ============
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ============ FUNÇÕES AUXILIARES ============

function getBrasiliaTime() {
    return new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function addLog(type, message, data = null) {
    const log = {
        id: Date.now() + Math.random(),
        timestamp: getBrasiliaTime(),
        type,
        message,
        data
    };
    
    logs.unshift(log);
    if (logs.length > 500) {
        logs = logs.slice(0, 500);
    }
    
    console.log(`[${log.timestamp}] ${type}: ${message}`);
}

// ============ PERSISTÊNCIA DE DADOS ============

async function ensureDataDir() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        await fs.mkdir(path.join(__dirname, 'public'), { recursive: true });
    } catch (error) {
        addLog('DATA_DIR_ERROR', 'Erro ao criar diretórios: ' + error.message);
    }
}

async function saveScheduleToFile() {
    try {
        await ensureDataDir();
        const scheduleData = {
            schedule: statusSchedule,
            isSystemActive,
            currentCycleStartDate,
            lastUpdate: getBrasiliaTime(),
            totalDays: statusSchedule.length
        };
        
        await fs.writeFile(SCHEDULE_FILE, JSON.stringify(scheduleData, null, 2));
        addLog('SCHEDULE_SAVE', `Cronograma salvo: ${statusSchedule.length} dias programados`);
    } catch (error) {
        addLog('SCHEDULE_SAVE_ERROR', 'Erro ao salvar cronograma: ' + error.message);
    }
}

async function loadScheduleFromFile() {
    try {
        const data = await fs.readFile(SCHEDULE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        
        statusSchedule = parsed.schedule || [];
        isSystemActive = parsed.isSystemActive !== undefined ? parsed.isSystemActive : true;
        currentCycleStartDate = parsed.currentCycleStartDate;
        
        addLog('SCHEDULE_LOAD', `Cronograma carregado: ${statusSchedule.length} dias`);
        return true;
    } catch (error) {
        addLog('SCHEDULE_LOAD_ERROR', 'Nenhum cronograma anterior encontrado: ' + error.message);
        return false;
    }
}

async function saveLogsToFile() {
    try {
        await ensureDataDir();
        const logsData = {
            logs: logs.slice(0, 100),
            lastUpdate: getBrasiliaTime()
        };
        
        await fs.writeFile(LOGS_FILE, JSON.stringify(logsData, null, 2));
    } catch (error) {
        addLog('LOGS_SAVE_ERROR', 'Erro ao salvar logs: ' + error.message);
    }
}

// Auto-save a cada 30 segundos
setInterval(async () => {
    await saveScheduleToFile();
    await saveLogsToFile();
}, 30000);

// ============ EVOLUTION API - CORRIGIDA ============

async function sendToEvolution(instanceName, endpoint, payload) {
    const url = EVOLUTION_BASE_URL + endpoint + '/' + instanceName;
    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            timeout: 15000
        });
        return { ok: true, data: response.data };
    } catch (error) {
        return { 
            ok: false, 
            error: error.response?.data || error.message,
            status: error.response?.status
        };
    }
}

// FUNÇÃO CORRIGIDA - PROBLEMA PRINCIPAL ESTAVA AQUI
async function postStatus(instanceName, content) {
    const { type, text, mediaUrl } = content;
    
    // Campo obrigatório identificado no debug
    let payload = {
        statusJidList: [] // Lista vazia = enviar para todos os contatos
    };
    
    if (type === 'text') {
        payload.type = 'text';
        payload.content = text;
    } else if (type === 'image') {
        payload.type = 'image';
        payload.content = text || '';
        payload.media = mediaUrl;
    } else if (type === 'video') {
        payload.type = 'video'; 
        payload.content = text || '';
        payload.media = mediaUrl;
    } else if (type === 'audio') {
        payload.type = 'audio';
        payload.content = text || '';
        payload.media = mediaUrl;
    }
    
    return await sendToEvolution(instanceName, '/message/sendStatus', payload);
}

// ============ LÓGICA DE CRONOGRAMA ============

function getCurrentDay() {
    if (!currentCycleStartDate) {
        currentCycleStartDate = new Date().toISOString().split('T')[0];
        saveScheduleToFile();
    }
    
    const startDate = new Date(currentCycleStartDate + 'T00:00:00-03:00');
    const today = new Date();
    
    const diffTime = today.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const totalDays = statusSchedule.length || 10;
    const currentDay = (diffDays % totalDays) + 1;
    
    return {
        currentDay,
        totalDays,
        cycleStartDate: currentCycleStartDate,
        daysInCurrentCycle: diffDays + 1
    };
}

async function checkAndPostScheduledStatus() {
    if (!isSystemActive || statusSchedule.length === 0) {
        return;
    }
    
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const dayInfo = getCurrentDay();
    const currentDaySchedule = statusSchedule[dayInfo.currentDay - 1];
    
    if (!currentDaySchedule || !currentDaySchedule.posts) {
        return;
    }
    
    // Verificar posts agendados para este horário
    for (const post of currentDaySchedule.posts) {
        if (post.time === currentTime && !post.sentToday) {
            await sendScheduledPost(post, dayInfo.currentDay);
            post.sentToday = true;
            post.lastSent = getBrasiliaTime();
        }
    }
    
    // Reset diário às 00:00
    if (currentTime === '00:00') {
        resetDailyFlags();
    }
}

async function sendScheduledPost(post, dayNumber) {
    addLog('SCHEDULED_POST_START', `Enviando post programado - Dia ${dayNumber} às ${post.time}`, post);
    
    let successCount = 0;
    let failureCount = 0;
    const results = [];
    
    // Enviar para todas as instâncias simultaneamente
    const promises = INSTANCES.map(async (instanceName) => {
        try {
            const result = await postStatus(instanceName, post);
            
            if (result.ok) {
                successCount++;
                results.push({ instance: instanceName, status: 'success' });
                addLog('STATUS_POST_SUCCESS', `Status enviado com sucesso via ${instanceName}`);
            } else {
                failureCount++;
                results.push({ 
                    instance: instanceName, 
                    status: 'failed', 
                    error: result.error 
                });
                addLog('STATUS_POST_FAILED', `Falha no envio via ${instanceName}: ${JSON.stringify(result.error)}`);
            }
        } catch (error) {
            failureCount++;
            results.push({ 
                instance: instanceName, 
                status: 'error', 
                error: error.message 
            });
            addLog('STATUS_POST_ERROR', `Erro no envio via ${instanceName}: ${error.message}`);
        }
    });
    
    await Promise.all(promises);
    
    addLog('SCHEDULED_POST_COMPLETE', `Post finalizado - ${successCount} sucessos, ${failureCount} falhas`, {
        dayNumber,
        time: post.time,
        type: post.type,
        results
    });
    
    await saveScheduleToFile();
}

function resetDailyFlags() {
    statusSchedule.forEach(day => {
        if (day.posts) {
            day.posts.forEach(post => {
                post.sentToday = false;
            });
        }
    });
    
    addLog('DAILY_RESET', 'Flags diárias resetadas para novo ciclo');
    saveScheduleToFile();
}

// ============ API ENDPOINTS ============

// Dashboard principal
app.get('/api/status', (req, res) => {
    const dayInfo = getCurrentDay();
    const currentDaySchedule = statusSchedule[dayInfo.currentDay - 1] || { posts: [] };
    
    const stats = {
        isActive: isSystemActive,
        totalDays: statusSchedule.length,
        currentDay: dayInfo.currentDay,
        cycleStartDate: dayInfo.cycleStartDate,
        daysInCurrentCycle: dayInfo.daysInCurrentCycle,
        totalInstances: INSTANCES.length,
        currentTime: getBrasiliaTime(),
        postsToday: currentDaySchedule.posts ? currentDaySchedule.posts.length : 0,
        nextPosts: getNextPosts(3)
    };
    
    res.json({
        success: true,
        data: stats
    });
});

// Obter cronograma completo
app.get('/api/schedule', (req, res) => {
    res.json({
        success: true,
        data: {
            schedule: statusSchedule,
            isActive: isSystemActive,
            currentCycleStartDate,
            totalDays: statusSchedule.length
        }
    });
});

// Salvar cronograma completo
app.post('/api/schedule', (req, res) => {
    try {
        const { schedule, isActive } = req.body;
        
        if (!Array.isArray(schedule)) {
            return res.status(400).json({
                success: false,
                error: 'Cronograma deve ser um array'
            });
        }
        
        statusSchedule = schedule;
        isSystemActive = isActive !== undefined ? isActive : true;
        
        // Reset das flags e início de novo ciclo
        resetDailyFlags();
        currentCycleStartDate = new Date().toISOString().split('T')[0];
        
        saveScheduleToFile();
        
        addLog('SCHEDULE_UPDATE', `Cronograma atualizado: ${statusSchedule.length} dias programados`);
        
        res.json({
            success: true,
            message: 'Cronograma salvo com sucesso',
            data: {
                totalDays: statusSchedule.length,
                isActive: isSystemActive
            }
        });
        
    } catch (error) {
        addLog('SCHEDULE_UPDATE_ERROR', 'Erro ao atualizar cronograma: ' + error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Toggle sistema ativo/inativo
app.post('/api/toggle', (req, res) => {
    isSystemActive = !isSystemActive;
    
    addLog('SYSTEM_TOGGLE', `Sistema ${isSystemActive ? 'ativado' : 'desativado'}`);
    saveScheduleToFile();
    
    res.json({
        success: true,
        isActive: isSystemActive
    });
});

// Reiniciar ciclo
app.post('/api/restart-cycle', (req, res) => {
    currentCycleStartDate = new Date().toISOString().split('T')[0];
    resetDailyFlags();
    
    addLog('CYCLE_RESTART', 'Ciclo de cronograma reiniciado');
    saveScheduleToFile();
    
    res.json({
        success: true,
        message: 'Ciclo reiniciado com sucesso',
        newStartDate: currentCycleStartDate
    });
});

// Logs recentes
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const recentLogs = logs.slice(0, limit);
    
    res.json({
        success: true,
        data: recentLogs
    });
});

// Teste manual de envio
app.post('/api/test-post', async (req, res) => {
    const { type, text, mediaUrl, instances } = req.body;
    
    if (!type) {
        return res.status(400).json({
            success: false,
            error: 'Tipo de post é obrigatório'
        });
    }
    
    const targetInstances = instances && instances.length > 0 ? instances : INSTANCES;
    
    addLog('TEST_POST_START', `Iniciando teste de envio para ${targetInstances.length} instâncias`);
    
    let successCount = 0;
    let failureCount = 0;
    const results = [];
    
    // Processamento sequencial para evitar rate limiting
    for (const instanceName of targetInstances) {
        try {
            const result = await postStatus(instanceName, { type, text, mediaUrl });
            
            if (result.ok) {
                successCount++;
                results.push({ instance: instanceName, status: 'success' });
            } else {
                failureCount++;
                results.push({ 
                    instance: instanceName, 
                    status: 'failed', 
                    error: result.error 
                });
            }
            
            // Pequeno delay entre requisições
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            failureCount++;
            results.push({ 
                instance: instanceName, 
                status: 'error', 
                error: error.message 
            });
        }
    }
    
    addLog('TEST_POST_COMPLETE', `Teste finalizado - ${successCount} sucessos, ${failureCount} falhas`);
    
    res.json({
        success: true,
        results: {
            successCount,
            failureCount,
            details: results
        }
    });
});

// Debug Evolution - MELHORADO
app.get('/api/evolution-debug', async (req, res) => {
    const debugResults = [];
    
    try {
        // Teste 1: Listar instâncias ativas
        const listResponse = await axios.get(EVOLUTION_BASE_URL + '/instance/fetchInstances', {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            timeout: 10000
        });
        
        const activeInstances = listResponse.data.filter(instance => 
            INSTANCES.includes(instance.name) && instance.connectionStatus === 'open'
        );
        
        debugResults.push({
            test: 'Instâncias Evolution',
            status: 'success',
            data: {
                totalFound: listResponse.data.length,
                gabysFound: activeInstances.length,
                activeGabys: activeInstances.map(i => i.name),
                connectionStatus: activeInstances.map(i => ({
                    name: i.name,
                    status: i.connectionStatus
                }))
            }
        });
    } catch (error) {
        debugResults.push({
            test: 'Instâncias Evolution',
            status: 'failed',
            error: error.response?.data || error.message
        });
    }

    // Teste 2: Verificar formato correto da API
    try {
        const testPayload = {
            statusJidList: [],
            type: 'text',
            content: 'Teste de debug'
        };
        
        const testResponse = await axios.post(EVOLUTION_BASE_URL + '/message/sendStatus/GABY01', testPayload, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            timeout: 10000
        });
        
        debugResults.push({
            test: 'Formato API correto',
            status: 'success',
            data: testResponse.data
        });
    } catch (error) {
        debugResults.push({
            test: 'Formato API correto',
            status: 'failed',
            error: error.response?.data || error.message,
            statusCode: error.response?.status
        });
    }
    
    res.json({
        evolution_url: EVOLUTION_BASE_URL,
        api_key_configured: EVOLUTION_API_KEY !== 'SUA_API_KEY_AQUI',
        instances_configured: INSTANCES,
        debug_timestamp: getBrasiliaTime(),
        tests: debugResults
    });
});

// ============ FUNÇÕES AUXILIARES PARA API ============

function getNextPosts(limit = 5) {
    const posts = [];
    const dayInfo = getCurrentDay();
    
    for (let i = 0; i < statusSchedule.length && posts.length < limit; i++) {
        const dayIndex = (dayInfo.currentDay - 1 + i) % statusSchedule.length;
        const day = statusSchedule[dayIndex];
        const dayNumber = dayIndex + 1;
        
        if (day && day.posts) {
            day.posts.forEach(post => {
                if (posts.length < limit) {
                    posts.push({
                        day: dayNumber,
                        time: post.time,
                        type: post.type,
                        text: post.text ? post.text.substring(0, 50) + '...' : '',
                        scheduled: true
                    });
                }
            });
        }
    }
    
    return posts;
}

// ============ SERVIR FRONTEND ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status-index.html'));
});

// ============ INICIALIZAÇÃO ============

async function initializeSystem() {
    console.log('🔄 Inicializando Sistema de Status Programados...');
    
    await ensureDataDir();
    await loadScheduleFromFile();
    
    if (statusSchedule.length === 0) {
        statusSchedule = Array.from({ length: 10 }, (_, i) => ({
            day: i + 1,
            posts: []
        }));
        currentCycleStartDate = new Date().toISOString().split('T')[0];
        await saveScheduleToFile();
    }
    
    console.log('✅ Sistema inicializado');
    console.log(`📅 Cronograma: ${statusSchedule.length} dias`);
    console.log(`🕒 Horário: ${getBrasiliaTime()}`);
    console.log(`📊 Status: ${isSystemActive ? 'Ativo' : 'Inativo'}`);
}

// Verificar posts agendados a cada minuto
setInterval(checkAndPostScheduledStatus, 60000);

app.listen(PORT, async () => {
    console.log('='.repeat(70));
    console.log('📱 SISTEMA DE STATUS PROGRAMADOS V1.0');
    console.log('='.repeat(70));
    console.log('Porta:', PORT);
    console.log('Evolution API:', EVOLUTION_BASE_URL);
    console.log('Instâncias:', INSTANCES.length);
    console.log('Timezone: America/Sao_Paulo (Brasília)');
    console.log('');
    console.log('🌐 Painel: http://localhost:' + PORT);
    console.log('📡 API: http://localhost:' + PORT + '/api/status');
    console.log('='.repeat(70));
    
    await initializeSystem();
});
