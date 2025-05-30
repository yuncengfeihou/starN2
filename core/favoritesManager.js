// core/favoritesManager.js

import {
    getContext,
    saveMetadataDebounced,
} from '../../../../script.js'; // Adjust path as needed
import { uuidv4 } from '../../../utils.js';
import { pluginName } from './state.js';
import { getFullChatData, saveSpecificChatMetadata } from './chatIO.js';


/**
 * Ensures the favorites array exists in the current chat metadata accessed via getContext()
 * @returns {object | null} The chat metadata object if available and favorites array is ensured, null otherwise.
 */
export function ensureFavoritesArrayExists() {
    let context;
    try {
        context = getContext();
        if (!context || !context.chatMetadata) {
            console.error(`${pluginName}: ensureFavoritesArrayExists - context or context.chatMetadata is not available!`);
            return null;
        }
    } catch (e) {
        console.error(`${pluginName}: ensureFavoritesArrayExists - Error calling getContext():`, e);
        return null;
    }

    const chatMetadata = context.chatMetadata;
    if (!Array.isArray(chatMetadata.favorites)) {
        console.log(`${pluginName}: Initializing chatMetadata.favorites array for chat ${context.chatId}.`);
        chatMetadata.favorites = [];
    }
    return chatMetadata;
}

/**
 * Adds a favorite item to the specified chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 * @param {string|null} targetChatFile Optional chat file to add favorite to (no .jsonl), defaults to current viewing chat or global context
 * @param {Object} [options] Optional parameters.
 * @param {Array} [options.allChatsFavoritesDataCache] Cache of all chats data, used if targetChatFile is not current.
 * @param {Function} [options.updateFavoritesPopupCallback] Callback to update popup if open.
 * @param {string} [options.currentViewingChatFileInPopup] The chat file currently being viewed in the popup.
 */
export async function addFavorite(messageInfo, targetChatFile = null, options = {}) {
    const { allChatsFavoritesDataCache, updateFavoritesPopupCallback, currentViewingChatFileInPopup } = options;
    const context = getContext();
    const currentContextChatIdNoExt = String(context.chatId || '').replace('.jsonl', '');
    const chatFileToModify = targetChatFile ? String(targetChatFile).replace('.jsonl','') : (currentViewingChatFileInPopup || currentContextChatIdNoExt);

    console.log(`${pluginName}: addFavorite - 准备添加到${targetChatFile ? '指定' : '当前'}聊天 (${chatFileToModify}) 的收藏夹`);

    if (!chatFileToModify) {
        console.error(`${pluginName}: addFavorite - 无法确定目标聊天文件。`);
        return;
    }

    let metadataToUpdate;
    let messagesToUpdate = null;

    if (chatFileToModify === currentContextChatIdNoExt) {
        const globalChatMetadata = ensureFavoritesArrayExists();
        if (!globalChatMetadata) {
            console.error(`${pluginName}: addFavorite - 无法获取当前激活聊天的元数据。`);
            return;
        }
        metadataToUpdate = globalChatMetadata;
        messagesToUpdate = context.chat;
    } else if (allChatsFavoritesDataCache && allChatsFavoritesDataCache.length > 0) {
        const chatDataToUpdate = allChatsFavoritesDataCache.find(c =>
            String(c.fileName).replace('.jsonl', '') === chatFileToModify);

        if (chatDataToUpdate && chatDataToUpdate.metadata) {
            metadataToUpdate = JSON.parse(JSON.stringify(chatDataToUpdate.metadata));
            messagesToUpdate = chatDataToUpdate.messages;
            if (!messagesToUpdate) {
                console.warn(`${pluginName}: addFavorite - 缓存中聊天 ${chatFileToModify} 的消息数据为空，保存时可能不完整。`);
            }
        }
    }

    if (!metadataToUpdate) {
        console.warn(`${pluginName}: addFavorite - 未在当前上下文或缓存中找到聊天 ${chatFileToModify} 的元数据，尝试从后端加载...`);
        const fullChatData = await getFullChatData(context.characterId, context.groupId, chatFileToModify, !!context.groupId);
        if (fullChatData && fullChatData.metadata) {
            console.log(`${pluginName}: addFavorite - 成功从后端加载聊天 ${chatFileToModify} 的数据。`);
            metadataToUpdate = JSON.parse(JSON.stringify(fullChatData.metadata));
            messagesToUpdate = fullChatData.messages;
            // Recursively call or re-execute logic
            await addFavoriteLogic(messageInfo, metadataToUpdate, messagesToUpdate, chatFileToModify, context, allChatsFavoritesDataCache, updateFavoritesPopupCallback, currentViewingChatFileInPopup);
        } else {
            console.error(`${pluginName}: addFavorite - 无法获取聊天 ${chatFileToModify} 的元数据（加载失败）。`);
        }
        return;
    }

    await addFavoriteLogic(messageInfo, metadataToUpdate, messagesToUpdate, chatFileToModify, context, allChatsFavoritesDataCache, updateFavoritesPopupCallback, currentViewingChatFileInPopup);
}

async function addFavoriteLogic(messageInfo, metadata, messages, chatFile, currentContext, allChatsFavoritesDataCache, updateFavoritesPopupCallback, currentViewingChatFileInPopup) {
    if (!Array.isArray(metadata.favorites)) {
        console.log(`${pluginName}: 为聊天 ${chatFile} 初始化 favorites 数组 (in addFavoriteLogic)`);
        metadata.favorites = [];
    }

    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId,
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };

    metadata.favorites.push(item);
    console.log(`${pluginName}: 添加后收藏总数: ${metadata.favorites.length}`);

    if (chatFile === String(currentContext.chatId || '').replace('.jsonl', '')) {
        console.log(`${pluginName}: 保存当前激活聊天 ${chatFile} 的元数据`);
        saveMetadataDebounced();
    } else {
        console.log(`${pluginName}: 保存非激活聊天 ${chatFile} 的元数据`);
        await saveSpecificChatMetadata(chatFile, metadata, messages, allChatsFavoritesDataCache);
    }

    if (updateFavoritesPopupCallback && typeof updateFavoritesPopupCallback === 'function') {
        if (String(currentViewingChatFileInPopup).replace('.jsonl','') === chatFile) {
            await updateFavoritesPopupCallback(currentViewingChatFileInPopup);
        }
    }
}


/**
 * Removes a favorite by its ID from the specified chat
 * @param {string} favoriteId The ID of the favorite to remove
 * @param {string|null} targetChatFile Optional chat file to remove from (no .jsonl), defaults to current viewing chat or global context
 * @param {Object} [options] Optional parameters.
 * @param {Array} [options.allChatsFavoritesDataCache] Cache of all chats data.
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function removeFavoriteById(favoriteId, targetChatFile = null, options = {}) {
    const { allChatsFavoritesDataCache, currentViewingChatFileInPopup } = options;
    const context = getContext();
    const currentContextChatIdNoExt = String(context.chatId || '').replace('.jsonl', '');
    const chatFileToModify = targetChatFile ? String(targetChatFile).replace('.jsonl','') : (currentViewingChatFileInPopup || currentContextChatIdNoExt);

    if (!chatFileToModify) {
        console.error(`${pluginName}: removeFavoriteById - 未能确定目标聊天文件。`);
        return false;
    }

    let metadataToUpdate;
    let messagesToUpdate = null;

    if (chatFileToModify === currentContextChatIdNoExt) {
        const globalChatMetadata = ensureFavoritesArrayExists();
        if (!globalChatMetadata) return false;
        metadataToUpdate = globalChatMetadata;
        messagesToUpdate = context.chat;
    } else if (allChatsFavoritesDataCache && allChatsFavoritesDataCache.length > 0) {
        const chatData = allChatsFavoritesDataCache.find(c =>
            String(c.fileName).replace('.jsonl','') === chatFileToModify);
        if (chatData && chatData.metadata) {
            metadataToUpdate = JSON.parse(JSON.stringify(chatData.metadata));
            messagesToUpdate = chatData.messages;
        }
    }

    if (!metadataToUpdate) {
        console.warn(`${pluginName}: removeFavoriteById - 未能找到聊天 ${chatFileToModify} 的元数据。`);
        return false;
    }
    if (!Array.isArray(metadataToUpdate.favorites)) {
        console.warn(`${pluginName}: removeFavoriteById - 聊天 ${chatFileToModify} 没有收藏数组。`);
        return false;
    }

    const indexToRemove = metadataToUpdate.favorites.findIndex(fav => fav.id === favoriteId);
    if (indexToRemove !== -1) {
        metadataToUpdate.favorites.splice(indexToRemove, 1);
        if (chatFileToModify === currentContextChatIdNoExt) {
            saveMetadataDebounced();
        } else {
            await saveSpecificChatMetadata(chatFileToModify, metadataToUpdate, messagesToUpdate, allChatsFavoritesDataCache);
        }
        console.log(`${pluginName}: 已从聊天 ${chatFileToModify} 中删除收藏项 ${favoriteId}`);
        return true;
    }

    console.warn(`${pluginName}: 在聊天 ${chatFileToModify} 中未找到 ID 为 ${favoriteId} 的收藏。`);
    return false;
}

/**
 * Updates the note for a favorite item in the specified chat
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 * @param {string|null} targetChatFile Optional chat file to update in (no .jsonl), defaults to current viewing chat or global context
 * @param {Object} [options] Optional parameters.
 * @param {Array} [options.allChatsFavoritesDataCache] Cache of all chats data.
 */
export async function updateFavoriteNote(favoriteId, note, targetChatFile = null, options = {}) {
    const { allChatsFavoritesDataCache, currentViewingChatFileInPopup } = options;
    const context = getContext();
    const currentContextChatIdNoExt = String(context.chatId || '').replace('.jsonl', '');
    const chatFileToModify = targetChatFile ? String(targetChatFile).replace('.jsonl','') : (currentViewingChatFileInPopup || currentContextChatIdNoExt);

    if (!chatFileToModify) {
        console.error(`${pluginName}: updateFavoriteNote - 未能确定目标聊天文件。`);
        return;
    }

    let metadataToUpdate;
    let messagesToUpdate = null;

    if (chatFileToModify === currentContextChatIdNoExt) {
        const globalChatMetadata = ensureFavoritesArrayExists();
        if (!globalChatMetadata) return;
        metadataToUpdate = globalChatMetadata;
        messagesToUpdate = context.chat;
    } else if (allChatsFavoritesDataCache && allChatsFavoritesDataCache.length > 0) {
        const chatData = allChatsFavoritesDataCache.find(c =>
            String(c.fileName).replace('.jsonl','') === chatFileToModify);
        if (chatData && chatData.metadata) {
            metadataToUpdate = JSON.parse(JSON.stringify(chatData.metadata));
            messagesToUpdate = chatData.messages;
        }
    }

    if (!metadataToUpdate) {
        console.warn(`${pluginName}: updateFavoriteNote - 未能找到聊天 ${chatFileToModify} 的元数据。`);
        return;
    }
    if (!Array.isArray(metadataToUpdate.favorites)) {
        console.warn(`${pluginName}: updateFavoriteNote - 聊天 ${chatFileToModify} 没有收藏数组。`);
        return;
    }

    const favorite = metadataToUpdate.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        favorite.note = note;
        if (chatFileToModify === currentContextChatIdNoExt) {
            saveMetadataDebounced();
        } else {
            await saveSpecificChatMetadata(chatFileToModify, metadataToUpdate, messagesToUpdate, allChatsFavoritesDataCache);
        }
        console.log(`${pluginName}: 已更新聊天 ${chatFileToModify} 中收藏项 ${favoriteId} 的备注`);
    } else {
        console.warn(`${pluginName}: 在聊天 ${chatFileToModify} 中未找到 ID 为 ${favoriteId} 的收藏。`);
    }
}
