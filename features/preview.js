// features/preview.js

import {
    eventSource,
    event_types,
    chat,
    clearChat,
    doNewChat,
    openCharacterChat,
    renameChat,
    saveSettingsDebounced,
    getContext,
    // addOneMessage, // Use context.addOneMessage
} from '../../../../script.js'; // Adjust path
import { extension_settings } from '../../../extensions.js';
import { waitUntilCondition } from '../../../utils.js';
import { pluginName, previewState } from '../core/state.js';
import { getFullChatData } from '../core/chatIO.js';
import { ensureFavoritesArrayExists } from '../core/favoritesManager.js';
import { setupPreviewUI, restoreNormalChatUI } from '../ui/previewUI.js';

/**
 * 确保预览所需的数据可用
 * @returns {Object} 包含 characterId 和 groupId 的对象
 */
function ensurePreviewData() {
    if (!previewState.originalContext) {
        throw new Error('缺少预览所需的原始上下文信息');
    }
    return {
        characterId: previewState.originalContext.characterId,
        groupId: previewState.originalContext.groupId
    };
}

/**
 * 处理预览按钮点击 (包含UI修改和聊天重命名)
 * @param {string|null} chatFileToPreview 要预览的聊天文件名，不含 .jsonl
 * @param {Array|null} allChatsFavoritesDataCache Pass the cache if available for non-current chats
 */
export async function handlePreviewButtonClick(chatFileToPreview = null, allChatsFavoritesDataCache = null) {
    const chatFileToPreviewNoExt = chatFileToPreview ? String(chatFileToPreview).replace('.jsonl','') : null;
    console.log(`${pluginName}: 预览按钮被点击，目标聊天: ${chatFileToPreviewNoExt || '当前聊天'}`);
    toastr.info('正在准备预览聊天...');

    const initialContext = getContext();
    const initialContextChatIdNoExt = String(initialContext.chatId || '').replace('.jsonl','');

    // Store original context before any async operations that might change it
    previewState.originalContext = {
        characterId: initialContext.characterId,
        groupId: initialContext.groupId,
        chatId: initialContext.chatId,
    };
    // Reset active state here before starting, to handle re-entry
    previewState.isActive = false;
    previewState.previewChatId = null;
    restoreNormalChatUI(); // Clean up any previous preview UI

    console.log(`${pluginName}: 保存的原始上下文:`, JSON.parse(JSON.stringify(previewState.originalContext)));

    try {
        if (!initialContext.groupId && initialContext.characterId === undefined) {
            toastr.error('请先选择一个角色或群聊');
            previewState.originalContext = null; // Clear if precondition fails
            return;
        }

        const { characterId, groupId } = ensurePreviewData(); // Uses previewState.originalContext

        let favoritesToPreview = [];
        let originalChatMessagesForPreview = [];
        const targetChatFileNoExt = chatFileToPreviewNoExt || initialContextChatIdNoExt;

        if (!chatFileToPreviewNoExt || targetChatFileNoExt === initialContextChatIdNoExt) {
            const globalChatMetadata = ensureFavoritesArrayExists(); // For current active chat
            if (!globalChatMetadata || !Array.isArray(globalChatMetadata.favorites) || globalChatMetadata.favorites.length === 0) {
                toastr.warning('当前聊天没有收藏的消息可以预览');
                previewState.originalContext = null;
                return;
            }
            favoritesToPreview = globalChatMetadata.favorites;
            originalChatMessagesForPreview = initialContext.chat || [];
        } else {
            // Try from cache first if available
            let fullChatData;
            const cachedData = allChatsFavoritesDataCache?.find(c => String(c.fileName).replace('.jsonl', '') === targetChatFileNoExt);
            if (cachedData) {
                fullChatData = { metadata: cachedData.metadata, messages: cachedData.messages };
            } else {
                fullChatData = await getFullChatData(characterId, groupId, targetChatFileNoExt, !!groupId);
            }

            if (!fullChatData || !fullChatData.metadata || !Array.isArray(fullChatData.metadata.favorites) || fullChatData.metadata.favorites.length === 0) {
                toastr.warning(`聊天 "${targetChatFileNoExt}" 没有收藏的消息或无法加载。`);
                previewState.originalContext = null;
                return;
            }
            favoritesToPreview = fullChatData.metadata.favorites;
            originalChatMessagesForPreview = fullChatData.messages || [];
        }

        const previewKey = groupId ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[pluginName].previewChats[previewKey];
        let targetPreviewChatId = existingPreviewChatId;
        let needsRename = false;

        if (existingPreviewChatId) {
             if (String(initialContext.chatId).replace('.jsonl','') === String(existingPreviewChatId).replace('.jsonl','')) {
                targetPreviewChatId = initialContext.chatId;
                needsRename = true; // Even if it's the same chat, we might want to rename it if not already prefixed
            } else {
                // Switch to the existing preview chat
                needsRename = true;
                if (groupId) {
                    await openGroupChat(groupId, existingPreviewChatId);
                } else {
                    await openCharacterChat(existingPreviewChatId);
                }
            }
        } else {
            await doNewChat({ deleteCurrentChat: false });
            const newContextAfterCreation = getContext(); // Get context *after* new chat is made
            targetPreviewChatId = newContextAfterCreation.chatId;
            if (!targetPreviewChatId) throw new Error('创建预览聊天失败，无法获取新的 Chat ID');

            extension_settings[pluginName].previewChats[previewKey] = targetPreviewChatId;
            saveSettingsDebounced();
            needsRename = true;
        }

        // Wait for chat to actually change if a switch was initiated
        let currentContextAfterSwitchAttempt = getContext();
        if (String(currentContextAfterSwitchAttempt.chatId).replace('.jsonl','') !== String(targetPreviewChatId).replace('.jsonl','')) {
            try {
                targetPreviewChatId = await new Promise((resolve, reject) => {
                     const timeout = setTimeout(() => {
                        eventSource.off(event_types.CHAT_CHANGED, listener);
                        reject(new Error(`Waiting for CHAT_CHANGED to ${targetPreviewChatId} timed out`));
                    }, 5000);
                    const listener = (receivedChatId) => {
                        if (String(receivedChatId).replace('.jsonl','') === String(targetPreviewChatId).replace('.jsonl','')) {
                            clearTimeout(timeout);
                            eventSource.off(event_types.CHAT_CHANGED, listener);
                            requestAnimationFrame(() => resolve(receivedChatId));
                        }
                    };
                    eventSource.on(event_types.CHAT_CHANGED, listener);
                });
            } catch (error) {
                console.error(`${pluginName}: Error or timeout waiting for CHAT_CHANGED:`, error);
                toastr.error('切换到预览聊天时出错或超时，请重试');
                previewState.originalContext = null; // Clear on failure
                restoreNormalChatUI(); // Ensure UI is clean
                return;
            }
        } else {
            // If already on the target chat, still wait a frame for UI to settle
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        // Renaming logic
        const contextForRename = getContext(); // Get latest context, now should be the preview chat
        if (String(contextForRename.chatId).replace('.jsonl','') === String(targetPreviewChatId).replace('.jsonl','') && needsRename) {
            const oldFileNameWithExt = contextForRename.chatId;
             if (!oldFileNameWithExt || typeof oldFileNameWithExt !== 'string') {
                 toastr.warning('无法获取当前聊天名称，跳过重命名。');
             } else {
                const previewPrefix = "[收藏预览] ";
                let currentChatName = contextForRename.chatName || String(oldFileNameWithExt).replace('.jsonl','');

                let newNameNoExt = currentChatName;
                // Determine the source display name for the rename
                let sourceDisplayName = chatFileToPreviewNoExt;
                if (!chatFileToPreviewNoExt || chatFileToPreviewNoExt === initialContextChatIdNoExt) {
                    // If previewing current chat, or no specific chat file given (implies current)
                    sourceDisplayName = initialContext.chatName || initialContextChatIdNoExt;
                }

                if (!currentChatName.startsWith(previewPrefix)) {
                     newNameNoExt = `${previewPrefix}${sourceDisplayName}`;
                } else {
                    // If already prefixed, update the source if different
                    const currentSourceMatch = currentChatName.match(/\(源: (.*)\)$/);
                    if (currentSourceMatch && currentSourceMatch[1] !== sourceDisplayName) {
                        newNameNoExt = `${previewPrefix}${sourceDisplayName}`;
                    } else if (!currentSourceMatch) { // Is prefixed but no (源: ...) part
                         newNameNoExt = `${previewPrefix}${sourceDisplayName}`;
                    }
                }

                const finalNewNameNoExt = newNameNoExt.trim();

                if (finalNewNameNoExt && (currentChatName !== finalNewNameNoExt)) { // Only rename if name actually changes
                     try {
                        await renameChat(oldFileNameWithExt, finalNewNameNoExt); // renameChat expects no-ext for new name
                        targetPreviewChatId = finalNewNameNoExt + '.jsonl'; // Update with new name
                        // Update settings with the new name
                        const currentPreviewKey = contextForRename.groupId ? `group_${contextForRename.groupId}` : `char_${contextForRename.characterId}`;
                        if (extension_settings[pluginName].previewChats && currentPreviewKey in extension_settings[pluginName].previewChats) {
                            extension_settings[pluginName].previewChats[currentPreviewKey] = targetPreviewChatId;
                            saveSettingsDebounced();
                        }
                    } catch(renameError) {
                        console.error(`${pluginName}: 重命名预览聊天失败:`, renameError);
                        toastr.error('重命名预览聊天失败，请检查控制台');
                        targetPreviewChatId = oldFileNameWithExt; // Keep old name on failure
                    }
                } else {
                     targetPreviewChatId = oldFileNameWithExt; // No rename needed, use existing name
                }
            }
        } else {
             targetPreviewChatId = contextForRename.chatId; // If not renaming, this is the ID
        }

        clearChat();
        try {
            await waitUntilCondition(() => document.querySelectorAll('#chat .mes').length === 0, 2000, 50);
        } catch (error) {
            toastr.warning('清空聊天时可能超时，继续尝试填充消息...');
        }

        // Final check before filling
        const contextBeforeFill = getContext();
        if (String(contextBeforeFill.chatId).replace('.jsonl','') !== String(targetPreviewChatId).replace('.jsonl','')) {
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             restoreNormalChatUI();
             previewState.isActive = false;
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return;
        }

        // Now set up UI and state for active preview
        previewState.isActive = true;
        previewState.previewChatId = targetPreviewChatId;
        setupPreviewUI(targetPreviewChatId);

        const messagesToFill = [];
        const sortedFavoritesForFill = [...favoritesToPreview].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));

        for (const favItem of sortedFavoritesForFill) {
            const messageIndex = parseInt(favItem.messageId, 10);
            let foundMessage = null;
            if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChatMessagesForPreview.length) {
                if (originalChatMessagesForPreview[messageIndex]) {
                    foundMessage = originalChatMessagesForPreview[messageIndex];
                }
            }
            if (foundMessage) {
                 const messageCopy = JSON.parse(JSON.stringify(foundMessage));
                 if (!messageCopy.extra) messageCopy.extra = {};
                 if (!messageCopy.extra.swipes) messageCopy.extra.swipes = [];
                 messagesToFill.push({ message: messageCopy, mesid: messageIndex }); // Keep original mesid for context if needed
            } else {
                console.warn(`${pluginName}: Favorite message with original mesid ${favItem.messageId} not found. Skipping.`);
            }
        }

        const finalContextForFill = getContext(); // getContext() again to use its addOneMessage
        if (String(finalContextForFill.chatId).replace('.jsonl','') !== String(targetPreviewChatId).replace('.jsonl','')) {
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             restoreNormalChatUI();
             previewState.isActive = false;
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return;
        }

        let addedCount = 0;
        const BATCH_SIZE = 20; // Batch add messages
        for (let i = 0; i < messagesToFill.length; i += BATCH_SIZE) {
            const batch = messagesToFill.slice(i, i + BATCH_SIZE);
            const addPromises = batch.map(item => {
                return (async () => {
                    try {
                        // addOneMessage is a method on the context object
                        await finalContextForFill.addOneMessage(item.message, { scroll: false });
                        addedCount++;
                    } catch (error) {
                        console.error(`${pluginName}: Error adding message (original index=${item.mesid}):`, error);
                    }
                })();
            });
            await Promise.all(addPromises);
            if (i + BATCH_SIZE < messagesToFill.length) {
                 await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between batches
            }
        }

        if (addedCount > 0) {
            $('#chat').scrollTop(0); // Scroll to top after adding messages
            toastr.success(`已在预览模式下显示 ${addedCount} 条收藏消息${chatFileToPreviewNoExt && chatFileToPreviewNoExt !== initialContextChatIdNoExt ? ` (来自聊天: ${chatFileToPreviewNoExt})` : ''}`);
        } else if (messagesToFill.length > 0) { // If there were items but none added
             toastr.warning('准备了收藏消息，但未能成功添加到预览中。请检查控制台。');
        } else { // No favorites to begin with
             toastr.info('收藏夹为空，已进入（空的）预览模式。点击下方按钮返回。');
        }

    } catch (error) {
        console.error(`${pluginName}: Error during preview generation:`, error);
        const errorMsg = (error instanceof Error && error.message) ? error.message : '请查看控制台获取详细信息';
        toastr.error(`创建预览时出错: ${errorMsg}`);
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
    }
}
