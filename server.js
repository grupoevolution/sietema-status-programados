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

// ============ FUNÇÕES AUXILIARES CORRIGIDAS ============

// Helper para URLs
function joinUrl(...parts) {
    return parts.map(p => String(p).replace(/(^\/+|\/+$)/g, '')).join('/');
}

// Funções de horário de Brasília corrigidas
function getBrasiliaDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function getBrasiliaHHMM(date = null) {
    const d = date || getBrasiliaDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function normalizeHHMM(hhmm) {
    if (!hhmm) return hhmm;
    const parts = String(hhmm).split(':').map(p => Number(p));
    return `${String(parts[0] || 0).padStart(2,'0')}:${String(parts[1] || 0).padStart(2,'0')}`;
}

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
        
        // Normalizar horários ao carregar
        statusSchedule.forEach(day => {
            if (day.posts) {
                day.posts.forEach(post => {
                    if (post.time) {
                        post.time = normalizeHHMM(post.time);
                    }
                });
            }
        });
        
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
    const url = joinUrl(EVOLUTION_BASE_URL, endpoint, instanceName);
    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            timeout: 15000
        });
        addLog('EVOLUTION_RESPONSE', `Resposta ${instanceName}`, { status: response.status, data: response.data });
        return { ok: true, data: response.data, status: response.status };
    } catch (error) {
        const respData = error.response?.data;
        const respStatus = error.response?.status;
        const respHeaders = error.response?.headers;
        // log detalhado
        addLog('EVOLUTION_HTTP_ERROR', `Erro axios ${respStatus || ''} ${error.message}`, {
            responseData: respData,
            responseStatus: respStatus,
            responseHeaders: respHeaders,
            code: error.code,
            stack: error.stack
        });
        // também imprima no console (útil ao chamar curl)
        console.error('EVOLUTION_HTTP_ERROR_DETAILED', {
            instance: instanceName,
            status: respStatus,
            data: respData,
            fullResponse: JSON.stringify(respData, null, 2), // JSON completo expandido
            code: error.code,
            message: error.message
        });
        return { 
            ok: false, 
            error: respData || error.message,
            status: respStatus,
            code: error.code
        };
    }
}

// FUNÇÃO TEMPORÁRIA - PAYLOAD MÍNIMO PARA TESTE
async function postStatus(instanceName, content) {
    const { type, text } = content;

    if (type !== 'text') {
        // fallback para o comportamento anterior quando testar mídia
        // você pode expandir depois
        return await sendToEvolution(instanceName, '/message/sendStatus', {
            type,
            content: text || '',
            allContacts: true
        });
    }

    // payload mínimo para texto
    const payload = {
        type: 'text',
        content: text || '',
        allContacts: true
    };

    addLog('POST_PAYLOAD_BUILD', `Payload mínimo (text) para ${instanceName}`, { payload });

    return await sendToEvolution(instanceName, '/message/sendStatus', payload);
}

// ============ LÓGICA DE CRONOGRAMA CORRIGIDA ============

function getCurrentDay() {
    if (!currentCycleStartDate) {
        currentCycleStartDate = new Date().toISOString().split('T')[0];
        saveScheduleToFile();
    }
    
    const startDate = new Date(currentCycleStartDate + 'T00:00:00-03:00');
    const today = getBrasiliaDate();
    
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

    const currentTime = getBrasiliaHHMM();
    const dayInfo = getCurrentDay();
    const currentDaySchedule = statusSchedule[dayInfo.currentDay - 1];

    if (!currentDaySchedule || !currentDaySchedule.posts) {
        return;
    }

    for (const post of currentDaySchedule.posts) {
        const postTimeNormalized = normalizeHHMM(post.time);
        if (postTimeNormalized === currentTime && !post.sentToday) {
            await sendScheduledPost(post, dayInfo.currentDay);
            post.sentToday = true;
            post.lastSent = getBrasiliaTime();
        }
    }

    if (currentTime === '00:00') {
        resetDailyFlags();
    }
}

async function sendScheduledPost(post, dayNumber) {
    addLog('SCHEDULED_POST_START', `Enviando post programado - Dia ${dayNumber} às ${post.time}`, post);
    
    let successCount = 0;
    let failureCount = 0;
    const results = [];
    
    // Envio sequencial com delay para evitar throttling
    for (const instanceName of INSTANCES) {
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
            
            // Delay entre envios
            await new Promise(resolve => setTimeout(resolve, 250));
            
        } catch (error) {
            failureCount++;
            results.push({ 
                instance: instanceName, 
                status: 'error', 
                error: error.message 
            });
            addLog('STATUS_POST_ERROR', `Erro no envio via ${instanceName}: ${error.message}`);
        }
    }
    
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
        currentTimeHHMM: getBrasiliaHHMM(),
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
        
        // Normalizar horários ao salvar
        schedule.forEach(day => {
            if (day.posts) {
                day.posts.forEach(post => {
                    if (post.time) {
                        post.time = normalizeHHMM(post.time);
                    }
                });
            }
        });
        
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
    
    // Processamento sequencial com delay
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
            
            // Delay entre requisições
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

// Teste manual direto da Evolution API
app.post('/api/direct-test', async (req, res) => {
    try {
        const testPayloads = [
            // Teste 1: Formato mínimo
            {
                name: 'Formato mínimo',
                payload: {
                    type: 'text',
                    content: 'Teste mínimo',
                    allContacts: true
                }
            },
            // Teste 2: Com statusJidList vazio
            {
                name: 'Com statusJidList vazio',
                payload: {
                    type: 'text',
                    content: 'Teste com statusJidList',
                    statusJidList: []
                }
            },
            // Teste 3: Sem allContacts
            {
                name: 'Sem allContacts',
                payload: {
                    type: 'text',
                    content: 'Teste sem allContacts'
                }
            }
        ];

        const results = [];
        
        for (const test of testPayloads) {
            try {
                const response = await axios.post(
                    `${EVOLUTION_BASE_URL}/message/sendStatus/GABY01`, 
                    test.payload,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': EVOLUTION_API_KEY
                        },
                        timeout: 10000
                    }
                );
                
                results.push({
                    test: test.name,
                    status: 'success',
                    payload: test.payload,
                    response: response.data
                });
                
            } catch (error) {
                results.push({
                    test: test.name,
                    status: 'failed',
                    payload: test.payload,
                    error: error.response?.data,
                    statusCode: error.response?.status,
                    errorMessage: error.message
                });
            }
        }
        
        res.json({
            success: true,
            results,
            evolution_url: EVOLUTION_BASE_URL
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Debug Evolution - MELHORADO
app.get('/api/evolution-debug', async (req, res) => {
    const debugResults = [];
    
    try {
        // Teste 1: Listar instâncias ativas
        const listResponse = await axios.get(joinUrl(EVOLUTION_BASE_URL, 'instance/fetchInstances'), {
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
            type: 'text',
            allContacts: true,
            statusJidList: [],
            content: 'Teste de debug'
        };
        
        const testUrl = joinUrl(EVOLUTION_BASE_URL, 'message/sendStatus/GABY01');
        addLog('DEBUG_TEST_URL', `Testando URL: ${testUrl}`, { payload: testPayload });
        
        const testResponse = await axios.post(testUrl, testPayload, {
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
        current_time_hhmm: getBrasiliaHHMM(),
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
                        time: normalizeHHMM(post.time),
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
    console.log(`🕒 Horário HH:MM: ${getBrasiliaHHMM()}`);
    console.log(`📊 Status: ${isSystemActive ? 'Ativo' : 'Inativo'}`);
}

// Verificar posts agendados a cada minuto
setInterval(checkAndPostScheduledStatus, 60000);

app.listen(PORT, async () => {
    console.log('='.repeat(70));
    console.log('📱 SISTEMA DE STATUS PROGRAMADOS V1.0 - CORRIGIDO');
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
