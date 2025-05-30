// features/export.js

import {
    getContext, // Needed for context.userAlias, context.name1, context.name2, context.groups etc.
    timestampToMoment,
} from '../../../../script.js'; // Adjust path
import { pluginName } from '../core/state.js';
// ensureFavoritesArrayExists is for the *active* chat. Export functions can operate on any chat's data.
// The data (metadata, messages, chatName) should be passed in.

/**
 * Handles exporting the favorited messages to a text file. (TXT)
 * @param {string} chatFileToExport The filename (no ext) of the chat whose favorites are being exported.
 * @param {object} chatMetadataForExport The metadata object of the chat to export (should contain .favorites).
 * @param {Array} originalChatMessagesForExport Array of messages for the chat to export.
 * @param {string} entityChatNameForExport Display name for the character/group and chat.
 * @param {object} currentContext The current global context for userAlias etc.
 */
export async function handleExportFavorites(chatFileToExport, chatMetadataForExport, originalChatMessagesForExport, entityChatNameForExport, currentContext) {
    console.log(`${pluginName}: handleExportFavorites - 开始导出收藏 (TXT), 目标聊天: ${chatFileToExport}`);

    if (!chatMetadataForExport || !Array.isArray(chatMetadataForExport.favorites) || chatMetadataForExport.favorites.length === 0) {
        toastr.warning(`聊天 "${chatFileToExport}" 没有收藏的消息可以导出。`);
        return;
    }

    toastr.info('正在准备导出收藏 (TXT)...', '导出中');
    try {
        if (typeof timestampToMoment !== 'function') throw new Error('timestampToMoment function is not available.');

        const sortedFavorites = [...chatMetadataForExport.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
        const exportLines = [];
        const exportDate = timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss');

        exportLines.push(`收藏夹导出 (TXT)`);
        exportLines.push(`聊天: ${entityChatNameForExport}`);
        exportLines.push(`导出时间: ${timestampToMoment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}`);
        exportLines.push(`总收藏数: ${sortedFavorites.length}`);
        exportLines.push('---');
        exportLines.push('');

        for (const favItem of sortedFavorites) {
            const messageIndex = parseInt(favItem.messageId, 10);
            const message = (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChatMessagesForExport.length) 
                ? originalChatMessagesForExport[messageIndex] 
                : null;

            exportLines.push(`--- 消息 #${favItem.messageId} ---`);
            if (message) {
                 const sender = favItem.sender || (message.is_user ? (currentContext.userAlias || 'You') : (message.name || 'Character'));
                 let timestampStr = message.send_date ? timestampToMoment(message.send_date).format('YYYY-MM-DD HH:mm:ss') : '[时间未知]';
                 exportLines.push(`发送者: ${sender}`);
                 exportLines.push(`时间: ${timestampStr}`);
                 if (favItem.note) exportLines.push(`备注: ${favItem.note}`);
                 exportLines.push(`内容:`);
                 exportLines.push(message.mes || '[消息内容为空]');
            } else {
                 exportLines.push(`[原始消息内容不可用或已删除]`);
                 if (favItem.sender) exportLines.push(`原始发送者: ${favItem.sender}`);
                 if (favItem.note) exportLines.push(`备注: ${favItem.note}`);
            }
            exportLines.push(`--- 结束消息 #${favItem.messageId} ---`);
            exportLines.push('');
        }
        const exportedText = exportLines.join('\n');
        const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });
        const safeChatName = String(entityChatNameForExport).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeChatName}_收藏_${exportDate}.txt`;

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        toastr.success(`已成功导出 ${sortedFavorites.length} 条收藏到文件 "${filename}" (TXT)`, '导出完成');
    } catch (error) {
        console.error(`${pluginName}: handleExportFavorites (TXT) - 导出过程中发生错误:`, error);
        toastr.error(`导出收藏 (TXT) 时发生错误: ${error.message || '未知错误'}`);
    }
}


/**
 * Handles exporting the favorited messages to a JSONL file
 * @param {string} chatFileToExport The filename (no ext) of the chat.
 * @param {object} chatMetadataForExport The metadata object of the chat.
 * @param {Array} originalChatMessagesForExport Array of messages for the chat.
 * @param {string} entityChatNameForExport Display name for the character/group and chat.
 * @param {object} currentContext The current global context.
 */
export async function handleExportFavoritesJsonl(chatFileToExport, chatMetadataForExport, originalChatMessagesForExport, entityChatNameForExport, currentContext) {
    console.log(`${pluginName}: handleExportFavoritesJsonl - 开始导出收藏 (JSONL), 目标聊天: ${chatFileToExport}`);

    if (!chatMetadataForExport || !Array.isArray(chatMetadataForExport.favorites) || chatMetadataForExport.favorites.length === 0) {
        toastr.warning(`聊天 "${chatFileToExport}" 没有收藏的消息可以导出。`);
        return;
    }

    toastr.info('正在准备导出收藏 (JSONL)...', '导出中');
    try {
        if (typeof timestampToMoment !== 'function') throw new Error('timestampToMoment function is not available.');

        const sortedFavorites = [...chatMetadataForExport.favorites].sort((a, b) => {
            const idA = parseInt(a?.messageId, 10); const idB = parseInt(b?.messageId, 10);
            if (isNaN(idA) && isNaN(idB)) return 0; if (isNaN(idA)) return 1; if (isNaN(idB)) return -1;
            return idA - idB;
        });

        const exportMessageObjects = [];
        let exportedMessageCount = 0;
        for (const favItem of sortedFavorites) {
            const idx = parseInt(favItem.messageId, 10);
            if (isNaN(idx) || idx < 0) continue;
            const msg = idx < originalChatMessagesForExport.length ? originalChatMessagesForExport[idx] : null;
            if (msg) {
                exportMessageObjects.push(JSON.parse(JSON.stringify(msg))); // Deep copy
                exportedMessageCount++;
            }
        }

        if (exportedMessageCount === 0) {
            toastr.warning('未能找到任何可导出的收藏消息...'); return;
        }

        // Construct the metadata line for the JSONL file
        // This should reflect the structure of a chat file's first line
        const metadataObjectForFile = {
            user_name: currentContext.userAlias || currentContext.name1,
            character_name: entityChatNameForExport.split(' (聊天:')[0], // Try to get base entity name
            chat_create_date: chatMetadataForExport.create_date || timestampToMoment(Date.now()).format("YYYY-MM-DD HH:mm:ss"),
            chat_metadata: chatMetadataForExport // This is the crucial part, contains 'favorites'
        };
        // If it's a group chat, the main character_name might be the group name
        if (currentContext.groupId) {
             const group = currentContext.groups?.find(g => g.id === currentContext.groupId);
             metadataObjectForFile.character_name = group ? group.name : metadataObjectForFile.character_name;
        } else if (currentContext.characterId !== undefined) {
             metadataObjectForFile.character_name = currentContext.name2 || metadataObjectForFile.character_name;
        }


        const metadataLine = JSON.stringify(metadataObjectForFile);
        const messageLines = exportMessageObjects.map(o => JSON.stringify(o)).join('\n');
        const exportedJsonlText = metadataLine + '\n' + messageLines + '\n'; // Ensure trailing newline for last message

        const blob = new Blob([exportedJsonlText], { type: 'application/jsonlines;charset=utf-8' });
        const safeName = String(entityChatNameForExport).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeName}_收藏_${timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss')}.jsonl`;

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        toastr.success(`已成功导出 ${exportedMessageCount} 条收藏到 "${filename}"`, '导出完成');
    } catch (error) {
        console.error(`${pluginName}: handleExportFavoritesJsonl 错误:`, error);
        toastr.error(`导出 JSONL 时发生错误: ${error.message || '未知错误'}`);
    }
}


/**
 * Handles exporting the favorited messages to a SillyTavern World Book (JSON) file.
 * @param {string} chatFileToExport The filename (no ext) of the chat.
 * @param {object} chatMetadataForExport The metadata object of the chat.
 * @param {Array} originalChatMessagesForExport Array of messages for the chat.
 * @param {string} entityChatNameForExport Display name for the character/group and chat.
 */
export async function handleExportFavoritesWorldbook(chatFileToExport, chatMetadataForExport, originalChatMessagesForExport, entityChatNameForExport) {
    console.log(`${pluginName}: handleExportFavoritesWorldbook - 开始导出 (世界书 JSON), 目标聊天: ${chatFileToExport}`);

    if (!chatMetadataForExport || !Array.isArray(chatMetadataForExport.favorites) || chatMetadataForExport.favorites.length === 0) {
        toastr.warning(`聊天 "${chatFileToExport}" 没有收藏的消息可以导出为世界书。`);
        return;
    }

    toastr.info('正在准备导出收藏 (世界书 JSON)...', '导出中');
    try {
        if (typeof timestampToMoment !== 'function') throw new Error('timestampToMoment function is not available.');

        const sortedFavorites = [...chatMetadataForExport.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
        const worldbookData = { entries: {} };
        let exportedEntryCount = 0;

        for (const favItem of sortedFavorites) {
            const idx = parseInt(favItem.messageId, 10);
            const message = (!isNaN(idx) && originalChatMessagesForExport && idx < originalChatMessagesForExport.length) 
                            ? originalChatMessagesForExport[idx] 
                            : null;
            if (!message) continue;

            exportedEntryCount++;
            const roleValue = message.is_user ? 1 : 2; // 1 for user, 2 for char/bot
            worldbookData.entries[idx] = { // Using original message index as UID for simplicity here
                uid: idx, // Consider generating a new UID if these could clash or need uniqueness across exports
                key: [], // Keywords - consider extracting from message or note if desired
                keysecondary: [],
                comment: `收藏消息 #${idx} - ${message.name || favItem.sender || (message.is_user ? 'User' : 'Character')}${favItem.note ? ' (备注: ' + favItem.note + ')' : ''}`,
                content: message.mes || "",
                constant: true, // Typically true for lorebook entries
                vectorized: false, // Default, can be changed if vectorization is intended
                selective: false,
                selectiveLogic: 0,
                addMemo: true, // Whether to add to context
                order: idx,    // Order in context, original message order
                position: 4,   // Position: 0=top, 1=middle, 2=bottom, 3=after string, 4=before string (default for WI)
                disable: false,
                excludeRecursion: false,
                preventRecursion: true,
                delayUntilRecursion: false,
                probability: 100,
                useProbability: false,
                depth: 0,
                group: "",
                groupOverride: false,
                groupWeight: 100,
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                useGroupScoring: null,
                automationId: "",
                role: roleValue,
                sticky: 0,
                cooldown: 0,
                delay: 0,
                displayIndex: idx
            };
        }

        if (exportedEntryCount === 0) {
            toastr.warning('未找到可导出的收藏消息世界书条目。'); return;
        }

        const exportedJsonText = JSON.stringify(worldbookData, null, 2);
        const safeName = String(entityChatNameForExport).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeName}_收藏世界书_${timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss')}.json`;

        const blob = new Blob([exportedJsonText], { type: 'application/json;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        toastr.success(`已成功导出 ${exportedEntryCount} 条收藏到 "${filename}"`, '导出完成');
    } catch (error) {
        console.error(`${pluginName}: handleExportFavoritesWorldbook 错误:`, error);
        toastr.error(`导出世界书时发生错误: ${error.message || '未知错误'}`);
    }
}
