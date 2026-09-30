const DB_NAME = 'sift-db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'current';

export interface SavedSession {
    key: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    fileBlob: Blob;
    hasHeaders: boolean;
    dropFirstRow: boolean;
    delimiter: string;
    savedAt: number;
}

/**
 * Открывает соединение с IndexedDB.
 */
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveSession(
    file: File,
    hasHeaders: boolean,
    dropFirstRow: boolean,
    delimiter: string,
): Promise<void> {
    const db = await openDB();

    const session: SavedSession = {
        key: SESSION_KEY,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileBlob: file,
        hasHeaders,
        dropFirstRow,
        delimiter,
        savedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(session);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Загружает сохранённую сессию, если она есть.
 */
export async function loadSession(): Promise<SavedSession | null> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(SESSION_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Очищает сохранённую сессию.
 */
export async function clearSession(): Promise<void> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(SESSION_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Преобразует SavedSession обратно в File.
 */
export function sessionToFile(session: SavedSession): File {
    return new File([session.fileBlob], session.fileName, {
        type: session.fileType,
        lastModified: session.savedAt,
    });
}