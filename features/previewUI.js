// ui/previewUI.js

import {
    getContext,
    openCharacterChat,
    openGroupChat,
} from '../../../../script.js'; // Adjust path
import { previewState, returnButtonId, pluginName } from '../core/state.js';

/**
 * 将UI从预览模式恢复为正常模式
 */
export function restoreNormalChatUI() {
    $(`#${returnButtonId}`).remove();
    // previewState.isActive = false; // State should be managed by the caller (features/preview.js)
    $('.preview-mode-indicator').remove(); // If you add such an indicator
}

/**
 * 设置预览模式的UI
 * @param {string} previewChatIdWithExt 当前预览聊天的ID (带 .jsonl)
 */
export function setupPreviewUI(previewChatIdWithExt) {
    // previewState.isActive = true; // State managed by caller
    // previewState.previewChatId = previewChatIdWithExt; // State managed by caller

    const returnButtonHtml = `<button id="${returnButtonId}" class="menu_button">
        <i class="fa-solid fa-arrow-left"></i> 返回原聊天
    </button>`;
    // Insert before chat or another suitable prominent place
    $('#chat').before(returnButtonHtml); 

    $(`#${returnButtonId}`).on('click', async function() {
        if (previewState.originalContext) {
            try {
                const { characterId, groupId, chatId: originalChatIdWithExt } = previewState.originalContext;

                // It's crucial to reset state *before* initiating chat switch,
                // especially if CHAT_CHANGED handlers depend on previewState.isActive
                const wasActive = previewState.isActive; // Store current state
                previewState.isActive = false; // Tentatively set to false

                restoreNormalChatUI(); // Clean up UI first

                // Nullify originalContext only after successful switch or if it's safe to do so earlier
                // previewState.originalContext = null; 
                // previewState.previewChatId = null;

                if (groupId) {
                    await openGroupChat(groupId, originalChatIdWithExt);
                } else if (characterId !== undefined) {
                    await openCharacterChat(originalChatIdWithExt);
                }
                // After successful switch, ensure state is fully reset
                previewState.originalContext = null; 
                previewState.previewChatId = null;

                toastr.success('已返回到原始聊天');

            } catch (error) {
                console.error(`${pluginName}: Error returning to original chat:`, error);
                toastr.error('返回原聊天时发生错误');
                // If error, potentially restore previewState.isActive if needed, though usually means something's broken
                // previewState.isActive = wasActive; // Revert if switch failed but UI was already restored
            }
        } else {
            toastr.warning('无法返回原聊天，上下文信息已丢失');
            // Ensure UI is clean even if context is lost
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null;
            previewState.previewChatId = null;
        }
    });
}


/**
 * 处理聊天切换事件，用于在离开预览时恢复UI
 * @param {string} newChatId 新切换到的聊天ID (带 .jsonl)
 */
export function handleChatChangeForPreview(newChatId) {
    if (previewState.isActive && previewState.previewChatId) {
        if (String(newChatId).replace('.jsonl','') !== String(previewState.previewChatId).replace('.jsonl','')) {
            console.log(`${pluginName}: Chat changed from preview (${previewState.previewChatId}) to ${newChatId}. Restoring UI.`);
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null; // Clear original context as we've left the preview flow
            previewState.previewChatId = null;
        }
    }
}
