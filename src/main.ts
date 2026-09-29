import './styles.css';

import { loadFile, type ParsedData } from './loader.js';
import { collectMemoryStats, formatBytes } from './memory.js';
import { saveSession, loadSession, clearSession, sessionToFile } from './storage.js';

// === Валидация форматов ===
const ALLOWED_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;

function getExtension(filename: string): string {
    return filename.toLowerCase().split('.').pop() ?? '';
}

function isAllowedFile(file: File): boolean {
    return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(file.name));
}

function showError(message: string) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    // Автоскрытие через 5 секунд
    window.setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function rejectAnimation() {
    dropZone.classList.add('reject');
    window.setTimeout(() => dropZone.classList.remove('reject'), 500);
}

// === DOM ===
const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const hasHeadersCheckbox = document.getElementById('has-headers') as HTMLInputElement;
const resultDiv = document.getElementById('result') as HTMLDivElement;
const errorDiv = document.getElementById('error') as HTMLDivElement;
const currentFileBar = document.getElementById('current-file-bar') as HTMLDivElement;
const currentFileName = document.getElementById('current-file-name') as HTMLSpanElement;
const newFileBtn = document.getElementById('new-file-btn') as HTMLButtonElement;
const headerModal = document.getElementById('header-mode-modal') as HTMLDivElement;
const modalDrop = document.getElementById('modal-drop') as HTMLButtonElement;
const modalKeep = document.getElementById('modal-keep') as HTMLButtonElement;
const modalCancel = document.getElementById('modal-cancel') as HTMLButtonElement;
const promoteModal = document.getElementById('promote-headers-modal') as HTMLDivElement;
const promoteConfirm = document.getElementById('promote-confirm') as HTMLButtonElement;
const promoteCancel = document.getElementById('promote-cancel') as HTMLButtonElement;
const delimiterLabel = document.getElementById('delimiter-label') as HTMLLabelElement;
const delimiterSelect = document.getElementById('delimiter-select') as HTMLSelectElement;
const delimiterDetected = document.getElementById('delimiter-detected') as HTMLSpanElement;

// === Клик по drop-zone — открыть диалог выбора файла ===
dropZone.addEventListener('click', () => fileInput.click());

// === Выбор файла через диалог ===
fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) handleFile(fileInput.files[0]);
});

// === Drag & drop ===
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

/// === Вставка через Ctrl+V — только файлы с разрешённым расширением ===
document.addEventListener('paste', (e) => {
    // Не реагируем, если файл уже загружен
    if (dropZone.style.display === 'none') return;

    const items = e.clipboardData?.items;
    if (!items) return;

    // Ищем файл в буфере
    let foundFile: File | null = null;
    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                foundFile = file;
                break;
            }
        }
    }

    if (foundFile) {
        e.preventDefault();
        handleFile(foundFile);
        return;
    }

    // Если в буфере текст — отклоняем (по требованию: никакие другие данные)
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.trim().length > 0) {
        e.preventDefault();
        showError(
            'Вставка текста не поддерживается. Скопируйте файл (.csv, .xlsx, .xls) в проводнике и вставьте через Ctrl+V.',
        );
        rejectAnimation();
    }
});

// === Кнопка «Загрузить другой файл» ===
newFileBtn.addEventListener('click', async () => {
    await clearSession();
    currentFileBar.style.display = 'none';
    dropZone.style.display = '';
    resultDiv.innerHTML = '';
    fileInput.value = '';
    delimiterSelect.value = 'auto';
    delimiterDetected.textContent = '';
});

// === Переключение чекбокса заголовков ===
hasHeadersCheckbox.addEventListener('change', async () => {
    const session = await loadSession();
    if (!session) return;

    const file = sessionToFile(session);
    const nowChecked = hasHeadersCheckbox.checked;

    if (nowChecked) {
        // Пользователь СТАВИТ галочку → предупреждаем
        const mode = await askPromoteToHeaders();

        if (mode === 'cancel') {
            hasHeadersCheckbox.checked = false;
            return;
        }

        await handleFile(file, true, false);
    } else {
        // Пользователь СНИМАЕТ галочку → спрашиваем про первую строку
        const mode = await askHeaderMode();

        if (mode === 'cancel') {
            hasHeadersCheckbox.checked = true;
            return;
        }

        await handleFile(file, false, mode === 'drop');
    }
});

// === Главная функция ===
async function handleFile(
    file: File,
    overrideHeaders?: boolean,
    dropFirstRow: boolean = false,
    overrideDelimiter?: string,
) {
    if (!isAllowedFile(file)) {
        const ext = getExtension(file.name) || '(без расширения)';
        showError(
            `Формат «${ext}» не поддерживается. Разрешены: ${ALLOWED_EXTENSIONS.map((e) => '.' + e).join(', ')}`,
        );
        rejectAnimation();
        return;
    }

    errorDiv.style.display = 'none';

    const isFirstLoad = resultDiv.innerHTML.trim() === '';
    if (isFirstLoad) {
        resultDiv.innerHTML = '<p style="padding: 20px; color: #666;">Загрузка и парсинг…</p>';
    } else {
        resultDiv.classList.add('loading');
    }

    try {
        const delimiter = overrideDelimiter ?? (delimiterSelect.value as string);

        const data = await loadFile(file, {
            hasHeaders: overrideHeaders,
            dropFirstRow,
            delimiter,
        });

        hasHeadersCheckbox.checked = data.hasHeaders;

        // Обновляем UI разделителя
        if (data.sourceFormat === 'csv') {
            delimiterLabel.classList.remove('hidden');
            delimiterSelect.value = data.delimiterAuto ? 'auto' : data.delimiter;

            if (data.delimiterAuto && data.delimiter) {
                delimiterDetected.textContent = `→ "${visualizeDelimiter(data.delimiter)}"`;
            } else {
                delimiterDetected.textContent = '';
            }
        } else {
            // Excel — скрываем селект
            delimiterLabel.classList.add('hidden');
            delimiterDetected.textContent = '';
        }

        await saveSession(file, data.hasHeaders, data.dropFirstRow, delimiterSelect.value);

        dropZone.style.display = 'none';
        currentFileBar.style.display = 'flex';
        currentFileName.textContent = file.name;

        renderResult(data, file);
    } catch (err) {
        showError(`Ошибка: ${(err as Error).message}`);
        if (isFirstLoad) resultDiv.innerHTML = '';
    } finally {
        resultDiv.classList.remove('loading');
    }
}

delimiterSelect.addEventListener('change', async () => {
    const session = await loadSession();
    if (!session) return;

    const file = sessionToFile(session);
    await handleFile(
        file,
        hasHeadersCheckbox.checked,
        session.dropFirstRow,
        delimiterSelect.value,
    );
});

/**
 * Превращает технический символ разделителя в удобочитаемый вид.
 */
function visualizeDelimiter(d: string): string {
    if (d === '\t') return '\\t';
    if (d === ',') return ',';
    if (d === ';') return ';';
    if (d === '|') return '|';
    return d;
}

/**
 * Показывает модальное окно выбора режима первой строки.
 * Возвращает 'drop' | 'keep' | 'cancel'.
 */
function askHeaderMode(): Promise<'drop' | 'keep' | 'cancel'> {
    return new Promise((resolve) => {
        // Замеряем ширину скроллбара и сохраняем её в CSS-переменную
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);

        // Сохраняем позицию скролла
        const savedScrollY = window.scrollY;

        document.body.classList.add('modal-open');
        headerModal.classList.add('open');

        const cleanup = () => {
            headerModal.classList.remove('open');
            document.body.classList.remove('modal-open');
            // Возвращаем скролл на место
            window.scrollTo({ top: savedScrollY, behavior: 'instant' as ScrollBehavior });
            modalDrop.removeEventListener('click', onDrop);
            modalKeep.removeEventListener('click', onKeep);
            modalCancel.removeEventListener('click', onCancel);
        };

        const onDrop = () => { cleanup(); resolve('drop'); };
        const onKeep = () => { cleanup(); resolve('keep'); };
        const onCancel = () => { cleanup(); resolve('cancel'); };

        modalDrop.addEventListener('click', onDrop);
        modalKeep.addEventListener('click', onKeep);
        modalCancel.addEventListener('click', onCancel);
    });
}

/**
 * Показывает модальное окно при превращении первой строки в заголовки.
 * Возвращает 'promote' | 'cancel'.
 */
function askPromoteToHeaders(): Promise<'promote' | 'cancel'> {
    return new Promise((resolve) => {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
        const savedScrollY = window.scrollY;

        document.body.classList.add('modal-open');
        promoteModal.classList.add('open');

        const cleanup = () => {
            promoteModal.classList.remove('open');
            document.body.classList.remove('modal-open');
            window.scrollTo({ top: savedScrollY, behavior: 'instant' as ScrollBehavior });
            promoteConfirm.removeEventListener('click', onConfirm);
            promoteCancel.removeEventListener('click', onCancel);
        };

        const onConfirm = () => { cleanup(); resolve('promote'); };
        const onCancel = () => { cleanup(); resolve('cancel'); };

        promoteConfirm.addEventListener('click', onConfirm);
        promoteCancel.addEventListener('click', onCancel);
    });
}

// === Восстановление сессии при загрузке страницы ===
async function restoreSession() {
    try {
        const session = await loadSession();
        if (!session) return;

        // Восстанавливаем состояние UI
        hasHeadersCheckbox.checked = session.hasHeaders;
        delimiterSelect.value = session.delimiter || 'auto';

        const file = sessionToFile(session);
        await handleFile(
            file,
            session.hasHeaders,
            session.dropFirstRow,
            session.delimiter,
        );
    } catch (err) {
        console.warn('Не удалось восстановить сессию:', err);
    }
}

// === Рендер ===
function renderResult(data: ParsedData, file: File) {
    const previewRows = data.rows.slice(0, 50);
    const mem = collectMemoryStats(file, data);
    const memoryRatio = mem.fileSize > 0 ? (mem.parsedSize / mem.fileSize).toFixed(1) : '—';

    // === Строка статусов ===
    const headersChip = data.hasHeaders
        ? `<span class="status-chip good"><span class="chip-label">заголовки:</span> первая строка</span>`
        : data.dropFirstRow
            ? `<span class="status-chip warn"><span class="chip-label">заголовки:</span> первая строка удалена</span>`
            : `<span class="status-chip warn"><span class="chip-label">заголовки:</span> первая строка в данных</span>`;

    const delimiterChip = data.sourceFormat === 'csv'
        ? `<span class="status-chip info"><span class="chip-label">разделитель:</span> "${visualizeDelimiter(data.delimiter)}"${data.delimiterAuto ? ' (авто)' : ''}</span>`
        : '';

    const numericCount = data.columnTypes.filter((c) => c.type === 'numeric').length;
    const typesChip = `<span class="status-chip info"><span class="chip-label">числовых колонок:</span> ${numericCount} из ${data.columnCount}</span>`;
    const rowsChip = `<span class="status-chip info"><span class="chip-label">строк данных:</span> ${data.rowCount.toLocaleString('ru-RU')}</span>`;

    const statusLine = document.getElementById('status-line') as HTMLDivElement;
    if (statusLine) {
        statusLine.innerHTML = headersChip + delimiterChip + typesChip + rowsChip;
    }

    let html = `
        <div class="card">
            <h3 class="card-title">Файл</h3>
            <div class="file-row">
                <div class="metric">
                    <span class="value">${data.rowCount.toLocaleString('ru-RU')}</span>
                    <span class="label">Строк</span>
                </div>
                <div class="metric">
                    <span class="value">${data.columnCount}</span>
                    <span class="label">Колонок</span>
                </div>
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Память</h3>
            <div class="memory-row">
                <div class="metric info">
                    <span class="value">${formatBytes(mem.fileSize)}</span>
                    <span class="label">Размер файла</span>
                </div>
                <div class="metric warn">
                    <span class="value">${formatBytes(mem.parsedSize)}</span>
                    <span class="label">Оценка в памяти ×${memoryRatio}</span>
                </div>
                <div class="metric">
                    <span class="value">${formatBytes(mem.numericCompactSize)}</span>
                    <span class="label">Числа в Float64Array</span>
                </div>
                ${mem.heapUsed > 0 ? `
                    <div class="metric">
                        <span class="value">${formatBytes(mem.heapUsed)}</span>
                        <span class="label">JS Heap Used</span>
                    </div>
                ` : ''}
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Типы колонок</h3>
            <div class="columns">
                ${data.columnTypes.map((ct) => `
                    <span class="column-badge ${ct.type}" title="Числовых значений: ${Math.round(ct.numericRatio * 100)}%">
                        ${ct.name} · ${ct.type}
                    </span>
                `).join('')}
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Предпросмотр ${previewRows.length < data.rowCount ? `— первые ${previewRows.length} из ${data.rowCount}` : ''}</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>${data.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${previewRows.map((row) => `
                            <tr>${row.map((cell) => `<td>${cell == null ? '' : escapeHtml(String(cell))}</td>`).join('')}</tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    resultDiv.innerHTML = html;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]!));
}

// === Старт ===
restoreSession();