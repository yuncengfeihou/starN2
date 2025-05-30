// core/chatIO.js

import {
    getContext,
    getRequestHeaders,
    characters, // 确保导入，如果直接使用 context.characters 则可能不需要
    timestampToMoment,
} from '../../../../script.js'; // 路径可能需要根据实际SillyTavern结构调整
import { extension_settings } from '../../../extensions.js';
import { pluginName } from './state.js';

/**
 * 获取当前角色或群组的所有聊天文件及其元数据 (特别是收藏夹)
 * @returns {Promise<Array<{fileName: string, displayName: string, metadata: object, favorites: Array, messages: Array}>>}
 */
export async function getAllChatFavoritesForCurrentContext() {
    const context = getContext();
    if (!context) {
        console.error(`${pluginName}: getAllChatFavoritesForCurrentContext - Context not available.`);
        return [];
    }

    let chatListResponse;
    let requestBody;
    let allFavoritesData = []; // This local variable will be returned

    if (context.groupId) {
        console.log(`${pluginName}: Fetching chats for group ID: ${context.groupId}`);
        requestBody = { group_id: context.groupId, query: '' };
        try {
            chatListResponse = await fetch('/api/chats/search', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(requestBody),
            });
            if (!chatListResponse.ok) {
                throw new Error(`Failed to fetch chat list for group ${context.groupId}: ${chatListResponse.status}`);
            }
            const groupChatsMetadataList = await chatListResponse.json();

            if (!Array.isArray(groupChatsMetadataList)) {
                console.error(`${pluginName}: /api/chats/search for group did not return an array. Response:`, groupChatsMetadataList);
                return [];
            }

            for (const chatMeta of groupChatsMetadataList) {
                const chatFileNameWithExt = chatMeta.file_name;
                const chatFileNameNoExt = String(chatFileNameWithExt || '').replace('.jsonl', '');
                if (!chatFileNameNoExt) continue;

                const fullChatData = await getFullChatData(null, context.groupId, chatFileNameNoExt, true, chatMeta);
                if (fullChatData) {
                    allFavoritesData.push({
                        fileName: chatFileNameNoExt,
                        displayName: chatFileNameNoExt, // Or use chatMeta.name if available and preferred
                        metadata: fullChatData.metadata,
                        favorites: fullChatData.metadata.favorites || [],
                        messages: fullChatData.messages || [],
                        isGroup: true,
                        groupId: context.groupId
                    });
                } else {
                    console.warn(`${pluginName}: Failed to get full chat data for group chat ${chatFileNameNoExt}`);
                }
            }
        } catch (error) {
            console.error(`${pluginName}: Error fetching or processing group chats:`, error);
            return [];
        }
    } else if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        const charObj = context.characters[context.characterId];
        const charAvatar = charObj.avatar;
        console.log(`${pluginName}: Fetching chats for character avatar: ${charAvatar}`);
        requestBody = { avatar_url: charAvatar };
        try {
            chatListResponse = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(requestBody),
            });
            if (!chatListResponse.ok) {
                throw new Error(`Failed to fetch chat list for character ${context.characterId}: ${chatListResponse.status}`);
            }
            const characterChatsArray = await chatListResponse.json();

            if (!Array.isArray(characterChatsArray)) {
                console.error(`${pluginName}: /api/characters/chats did not return an array. Response:`, characterChatsArray);
                return [];
            }

            for (const chatMetaDataFromServer of characterChatsArray) {
                const chatFileNameWithExt = chatMetaDataFromServer.file_name;
                if (!chatFileNameWithExt) {
                    console.warn(`${pluginName}: Chat metadata from server missing file_name:`, chatMetaDataFromServer);
                    continue;
                }
                const chatFileNameNoExt = String(chatFileNameWithExt).replace('.jsonl', '');
                if (!chatFileNameNoExt) continue;

                const fullChatData = await getFullChatData(context.characterId, null, chatFileNameNoExt, false, chatMetaDataFromServer);
                if (fullChatData) {
                    allFavoritesData.push({
                        fileName: chatFileNameNoExt,
                        displayName: chatFileNameNoExt, // Or use chatMetaDataFromServer.name if available
                        metadata: fullChatData.metadata,
                        favorites: fullChatData.metadata.favorites || [],
                        messages: fullChatData.messages || [],
                        isGroup: false,
                        characterId: context.characterId
                    });
                } else {
                    console.warn(`${pluginName}: Failed to get full chat data for character chat ${chatFileNameNoExt}`);
                }
            }
        } catch (error) {
            console.error(`${pluginName}: Error fetching or processing character chats:`, error);
            return [];
        }
    } else {
        console.warn(`${pluginName}: No active character or group.`);
        return [];
    }

    const currentContextChatIdNoExt = String(context.chatId || '').replace('.jsonl','');
    console.log(`${pluginName}: Current context chatId (no ext): "${currentContextChatIdNoExt}", Loaded chat files (no ext):`, allFavoritesData.map(d => d.fileName));
    console.log(`${pluginName}: Favorites count per chat:`, allFavoritesData.map(d => ({
        fileName: d.fileName,
        favCount: d.favorites?.length || 0
    })));

    allFavoritesData.sort((a, b) => {
        const aClean = a.fileName;
        const bClean = b.fileName;
        if (aClean === currentContextChatIdNoExt && bClean !== currentContextChatIdNoExt) return -1;
        if (bClean === currentContextChatIdNoExt && aClean !== currentContextChatIdNoExt) return 1;
        return aClean.localeCompare(bClean);
    });

    return allFavoritesData;
}

/**
 * 获取单个指定聊天的完整数据 (元数据和消息)
 * @param {string|null} characterId - 角色ID (如果不是群组)
 * @param {string|null} groupId - 群组ID (如果是群组)
 * @param {string} chatFileNameNoExt - 聊天文件名 (不带 .jsonl)
 * @param {boolean} isGroup - 是否为群组聊天
 * @param {object|null} providedMetadata - 可选的外部提供的元数据
 * @returns {Promise<{metadata: object, messages: Array}|null>}
 */
export async function getFullChatData(characterId, groupId, chatFileNameNoExt, isGroup, providedMetadata = null) {
    const context = getContext();
    let endpoint;
    let requestBody;
    let finalMetadataObject = { favorites: [] };
    let messages = [];

    // This function needs access to allChatsFavoritesData if it's to use it as a cache.
    // For now, I'll assume it's not using a global cache directly but rather the caller might provide it.
    // The original logic for group chats had a specific cache check:
    // else {
    //     const cachedChat = allChatsFavoritesData.find(c => ...);
    //     ...
    // }
    // This implies allChatsFavoritesData should be accessible or passed.
    // For this refactoring, I'll keep it as is, assuming providedMetadata or context.chatMetadata is prioritized.
    // If a deeper cache check is needed here, allChatsFavoritesData would need to be imported or passed.

    try {
        if (isGroup) {
            if (!groupId) {
                console.error(`${pluginName}: getFullChatData (group) - groupId is missing.`);
                return null;
            }
            endpoint = '/api/chats/group/get';
            requestBody = { id: groupId, chat_id: chatFileNameNoExt };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                console.error(`${pluginName}: 获取群组聊天 ${chatFileNameNoExt} 消息失败 - ${response.status}`);
            } else {
                const groupChatData = await response.json();
                if (Array.isArray(groupChatData)) {
                    if (groupChatData.length > 0 && typeof groupChatData[0] === 'object' && !Array.isArray(groupChatData[0]) &&
                       (groupChatData[0].user_name !== undefined || groupChatData[0].character_name !== undefined)) {
                        const rawMetadata = groupChatData[0];
                        if (typeof rawMetadata.chat_metadata === 'object' && rawMetadata.chat_metadata !== null) {
                            finalMetadataObject = JSON.parse(JSON.stringify(rawMetadata.chat_metadata));
                        } else {
                            finalMetadataObject = JSON.parse(JSON.stringify(rawMetadata));
                        }
                        messages = groupChatData.slice(1);
                    } else {
                        messages = groupChatData;
                    }
                } else if (typeof groupChatData === 'object' && groupChatData !== null && Object.keys(groupChatData).length === 0) {
                    console.warn(`${pluginName}: 群组聊天 ${chatFileNameNoExt} 的 /api/chats/group/get 返回了空对象。消息将为空。`);
                    messages = [];
                } else {
                    console.warn(`${pluginName}: 群组聊天 ${chatFileNameNoExt} 的消息API未返回预期的数组或空对象，实际返回:`, groupChatData);
                    messages = [];
                }
            }

            if (groupId === context.groupId && chatFileNameNoExt === String(context.chatId || '').replace('.jsonl','')) {
                finalMetadataObject = JSON.parse(JSON.stringify(context.chatMetadata || { favorites: [] }));
                console.log(`${pluginName}: 使用当前激活群组聊天的元数据 (chatId: ${chatFileNameNoExt})`);
            }
            else if (providedMetadata) {
                if (typeof providedMetadata.chat_metadata === 'object' && providedMetadata.chat_metadata !== null) {
                    finalMetadataObject = JSON.parse(JSON.stringify(providedMetadata.chat_metadata));
                    console.log(`${pluginName}: 使用外部提供的chat_metadata (chatId: ${chatFileNameNoExt})`);
                } else {
                    finalMetadataObject = JSON.parse(JSON.stringify(providedMetadata));
                    console.log(`${pluginName}: 使用外部提供的元数据 (chatId: ${chatFileNameNoExt})`);
                }
            }
            // Removed direct allChatsFavoritesData check here, as it's not passed in.
            // Caller (like getAllChatFavoritesForCurrentContext) would have this data if needed.

        } else { // 角色聊天
            if (characterId === undefined || characterId === null || !context.characters || !context.characters[characterId]) {
                console.error(`${pluginName}: getFullChatData (character) - Invalid characterId or character data missing.`);
                return null;
            }
            const charObj = context.characters[characterId];
            endpoint = '/api/chats/get';
            requestBody = {
                ch_name: charObj.name,
                file_name: chatFileNameNoExt,
                avatar_url: charObj.avatar,
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                console.error(`${pluginName}: 获取角色聊天 ${chatFileNameNoExt} 数据失败 - ${response.status}`);
                return null;
            }
            const chatDataResponse = await response.json();

            if (Object.keys(chatDataResponse).length === 0 && chatDataResponse.constructor === Object) {
                console.warn(`${pluginName}: 角色聊天 ${chatFileNameNoExt} 的 /api/chats/get 返回了空对象。元数据和消息将为空。`);
                finalMetadataObject = { favorites: [] };
                messages = [];
            } else if (Array.isArray(chatDataResponse) && chatDataResponse.length > 0) {
                if (typeof chatDataResponse[0] === 'object' && chatDataResponse[0] !== null && !Array.isArray(chatDataResponse[0])) {
                    const rawMetadata = chatDataResponse[0];
                    if (typeof rawMetadata.chat_metadata === 'object' && rawMetadata.chat_metadata !== null) {
                        finalMetadataObject = JSON.parse(JSON.stringify(rawMetadata.chat_metadata));
                    } else {
                        console.warn(`${pluginName}: 角色聊天 ${chatFileNameNoExt} 的元数据对象缺少 'chat_metadata' 字段。尝试直接读取顶层元数据。`);
                        finalMetadataObject = JSON.parse(JSON.stringify(rawMetadata));
                    }
                    messages = chatDataResponse.slice(1);
                } else {
                    console.warn(`${pluginName}: 角色聊天 ${chatFileNameNoExt} API响应的第一个元素不是标准元数据对象，将尝试把整个响应视为消息数组。元数据将使用默认值。API Response:`, chatDataResponse);
                    messages = chatDataResponse.filter(item => typeof item === 'object' && item !== null);
                    finalMetadataObject = { favorites: [] };
                }
            } else if (typeof chatDataResponse === 'object' && chatDataResponse !== null && Object.keys(chatDataResponse).length > 0 && !Array.isArray(chatDataResponse)) {
                if (chatDataResponse.user_name !== undefined || chatDataResponse.character_name !== undefined || chatDataResponse.create_date !== undefined) {
                    console.log(`${pluginName}: 角色聊天 ${chatFileNameNoExt} API响应被当作单一元数据对象处理。消息将为空。`);
                    if (typeof chatDataResponse.chat_metadata === 'object' && chatDataResponse.chat_metadata !== null) {
                        finalMetadataObject = JSON.parse(JSON.stringify(chatDataResponse.chat_metadata));
                    } else {
                        finalMetadataObject = JSON.parse(JSON.stringify(chatDataResponse));
                    }
                    messages = [];
                } else {
                    console.warn(`${pluginName}: 角色聊天 ${chatFileNameNoExt} API响应对象格式未知，无法提取元数据或消息。`);
                    finalMetadataObject = { favorites: [] };
                    messages = [];
                }
            } else {
                console.warn(`${pluginName}: 角色聊天 ${chatFileNameNoExt} 数据为空数组或无效格式。元数据和消息将为空。API Response:`, chatDataResponse);
                finalMetadataObject = { favorites: [] };
                messages = [];
            }
        }

        if (!finalMetadataObject || typeof finalMetadataObject !== 'object') {
            finalMetadataObject = { favorites: [] };
        } else if (!Array.isArray(finalMetadataObject.favorites)) {
            finalMetadataObject.favorites = [];
        }

        console.log(`${pluginName}: getFullChatData for "${chatFileNameNoExt}" (isGroup: ${isGroup}) - Metadata keys: ${Object.keys(finalMetadataObject).length}, Messages count: ${messages.length}, Favorites count: ${finalMetadataObject.favorites.length}`);
        return { metadata: finalMetadataObject, messages };

    } catch (error) {
        console.error(`${pluginName}: getFullChatData 处理聊天 "${chatFileNameNoExt}" (isGroup: ${isGroup}) 时发生错误:`, error);
        return { metadata: { favorites: [] }, messages: [] };
    }
}

/**
 * 保存特定聊天文件的元数据 (包括收藏夹)
 * @param {string} chatFileNameNoExt 聊天文件名 (不带 .jsonl)
 * @param {object} metadataToSave 要保存的元数据对象
 * @param {Array} messagesArray 聊天消息数组 (如果已知)
 * @param {Array} allChatsFavoritesDataCache Optional: Pass the current cache for updating after save
 */
export async function saveSpecificChatMetadata(chatFileNameNoExt, metadataToSave, messagesArray = null, allChatsFavoritesDataCache = null) {
    const context = getContext();
    console.log(`${pluginName}: saveSpecificChatMetadata for ${chatFileNameNoExt}`);
    try {
        let chatContentToSave = [];
        const isGroupChat = !!context.groupId;
        let characterName, avatarUrl;

        if (messagesArray === null) {
            console.log(`${pluginName}: Messages not provided for ${chatFileNameNoExt}, fetching full chat data...`);
            const fullChatData = await getFullChatData(context.characterId, context.groupId, chatFileNameNoExt, isGroupChat);
            if (!fullChatData || !fullChatData.messages) {
                toastr.error(`保存聊天 "${chatFileNameNoExt}" 的收藏夹变动时发生错误：无法加载完整的聊天消息。`);
                return;
            }
            messagesArray = fullChatData.messages;
        }

        const finalMetadataObjectForSave = {
            user_name: context.userAlias || context.name1 || "User",
            character_name: "Unknown",
            create_date: metadataToSave.create_date || timestampToMoment(Date.now()).format('YYYY-MM-DD HH:mm:ss'),
            chat_metadata: metadataToSave
        };

        chatContentToSave.push(finalMetadataObjectForSave);
        chatContentToSave.push(...messagesArray);

        let requestBody = {
            chat: chatContentToSave,
            file_name: chatFileNameNoExt,
            force: true
        };

        if (isGroupChat) {
            if (!context.groupId) {
                toastr.error("无法保存群组聊天收藏：群组ID未知。");
                return;
            }
            requestBody.is_group = true;
            requestBody.id = context.groupId;
            const group = context.groups?.find(g => g.id === context.groupId);
            finalMetadataObjectForSave.character_name = group ? group.name : "Group Chat";
        } else {
            if (context.characterId === undefined || !context.characters || !context.characters[context.characterId]) {
                toastr.error("无法保存角色聊天收藏：角色信息未知。");
                return;
            }
            const charObj = context.characters[context.characterId];
            characterName = charObj.name;
            avatarUrl = charObj.avatar;
            requestBody.ch_name = characterName;
            requestBody.avatar_url = avatarUrl;
            finalMetadataObjectForSave.character_name = characterName;
        }

        chatContentToSave[0] = finalMetadataObjectForSave; // Update after character_name is set

        const response = await fetch('/api/chats/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
            cache: 'no-cache',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with ${response.status}: ${errorText}`);
        }

        if (allChatsFavoritesDataCache) { // Update cache if provided
            const chatDataInCache = allChatsFavoritesDataCache.find(c => c.fileName === chatFileNameNoExt);
            if (chatDataInCache) {
                chatDataInCache.metadata = JSON.parse(JSON.stringify(metadataToSave));
                chatDataInCache.favorites = metadataToSave.favorites || [];
                chatDataInCache.messages = JSON.parse(JSON.stringify(messagesArray));
                console.log(`${pluginName}: Updated cache for ${chatFileNameNoExt}`);
            } else {
                console.warn(`${pluginName}: Chat ${chatFileNameNoExt} not found in provided cache after saving.`);
            }
        }

        toastr.success(`聊天 "${chatFileNameNoExt}" 的收藏夹变动已保存。`);

    } catch (error) {
        console.error(`${pluginName}: Error in saveSpecificChatMetadata for ${chatFileNameNoExt}`, error);
        toastr.error(`保存聊天 "${chatFileNameNoExt}" 的收藏夹变动时发生错误：${error.message || '未知错误'}`);
    }
}
