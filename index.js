// index.js (Main Entry Point)

import {
    eventSource,
    event_types,
    // chat, // No longer directly used here for message data
    // clearChat, // Used in features/preview.js
    // doNewChat, // Used in features/preview.js
    // openCharacterChat, // Used in ui/previewUI.js and features/preview.js
    // renameChat, // Used in features/preview.js
    // getRequestHeaders, // Used in core/chatIO.js
    saveSettingsDebounced, // Used in features/preview.js and ui/popup.js
    // characters, // Used in core/chatIO.js
    getContext, // Used across multiple modules
} from '../../../../script.js'; // Adjust path

import {
    renderExtensionTemplateAsync,
    extension_settings,
    // saveMetadataDebounced, // Now imported from script.js by core/favoritesManager.js
} from '../../../extensions.js';

// Import from new modules
import { pluginName, previewState } from './core/state.js'; // Assuming returnButtonId is not needed here
import { ensureFavoritesArrayExists, removeFavoriteById as fmRemoveFavoriteById } from './core/favoritesManager.js';
import { addFavoriteIconsToMessages, refreshFavoriteIconsInView, handleFavoriteToggle } from './ui/messageIcons.js';
import { showFavoritesPopup, updateFavoritesPopup as updateOpenFavoritesPopup } from './ui/popup.js';
import { handleChatChangeForPreview, restoreNormalChatUI } from './ui/previewUI.js';

// Initialize plugin settings if they don't exist
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}
if (!extension_settings[pluginName].previewChats) {
    extension_settings[pluginName].previewChats = {};
}
if (!extension_settings[pluginName].chatNotes) {
    extension_settings[pluginName].chatNotes = {};
}
console.log(`${pluginName}: 初始化插件设置 - previewChats: ${Object.keys(extension_settings[pluginName].previewChats).length}, chatNotes: ${Object.keys(extension_settings[pluginName].chatNotes).length}`);


/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // CSS is now primarily in style.css. No dynamic style injection here unless strictly necessary.
        // const styleElement = document.createElement('style');
        // styleElement.innerHTML = `...`; // Removed
        // document.head.appendChild(styleElement);

        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#extensions_settings').append(settingsHtml);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Event delegation for favorite toggle icons on messages
        // This remains here as it's a document-level delegation for dynamically added elements.
        // handleFavoriteToggle is imported from ui/messageIcons.js
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initial setup for the current chat
        ensureFavoritesArrayExists(); // From core/favoritesManager.js
        addFavoriteIconsToMessages();  // From ui/messageIcons.js
        refreshFavoriteIconsInView();  // From ui/messageIcons.js
        restoreNormalChatUI();         // From ui/previewUI.js, ensures clean state on load

        // SillyTavern Event Listeners
        eventSource.on(event_types.CHAT_CHANGED, (newChatId) => {
            handleChatChangeForPreview(newChatId); // From ui/previewUI.js
            ensureFavoritesArrayExists();          // For the newly active chat

            const currentChatIdNoExt = String(newChatId || '').replace('.jsonl','');
            if (!previewState.isActive) { // previewState from core/state.js
                const previewChatsMap = extension_settings[pluginName]?.previewChats;
                if (previewChatsMap && Object.values(previewChatsMap).some(id => String(id).replace('.jsonl','') === currentChatIdNoExt)) {
                     toastr.info(
                        `注意：当前聊天 "${currentChatIdNoExt}" 是收藏预览聊天。此聊天仅用于预览收藏消息，内容会在每次<预览>前清空。请勿在此聊天中发送消息。`,
                        '进入收藏预览聊天',
                        { timeOut: 8000, extendedTimeOut: 4000, preventDuplicates: true, positionClass: 'toast-top-center' }
                    );
                }
            }
            setTimeout(() => { // Ensure DOM is updated after chat change
                addFavoriteIconsToMessages();
                refreshFavoriteIconsInView();
            }, 150);
        });

        eventSource.on(event_types.MESSAGE_DELETED, async (deletedMessageIndex) => {
            const deletedMessageId = String(deletedMessageIndex);
            const chatMetadata = ensureFavoritesArrayExists(); // For the current chat
            if (!chatMetadata || !chatMetadata.favorites) return;

            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);
            if (favIndex !== -1) {
                const favToDelete = chatMetadata.favorites[favIndex];
                // removeFavoriteById from core/favoritesManager.js will handle saveMetadataDebounced
                // It expects targetChatFile to be null for current chat.
                // It also needs options for cache, but for current chat, cache isn't primary concern.
                await fmRemoveFavoriteById(favToDelete.id, null); 

                // If favorites popup is open and showing this chat, update it.
                // This requires a way to check if popup is open and what it's viewing.
                // Assuming updateOpenFavoritesPopup (from ui/popup.js) handles this check internally or needs parameters.
                // For now, we call it; ui/popup.js needs to be robust.
                // To do this properly, showFavoritesPopup should return the popup instance, or we need a getter.
                // Or, ui/popup.js can expose a function like isPopupOpenAndViewing(chatFile).
                // For simplicity, let's assume ui/popup.js's updateOpenFavoritesPopup can handle this.
                // We need to pass currentViewingChatFile. This is tricky as it's internal to popup.js
                // A better approach: emit a custom event that popup.js listens to, or popup.js polls/reacts.
                // Short-term: Try to update if it *might* be open.
                // This call is problematic because updateOpenFavoritesPopup needs currentViewingChatFile.
                // The original code had direct access. Now it doesn't.
                // A simple solution is to only refresh the *active* chat's icons,
                // and let the popup re-fetch when it's opened or its view changes.
                // If popup is open, it will get refreshed on its own next time user interacts with it or it auto-refreshes.
                // However, if the *currently viewed chat in the popup* is the one modified, it should update.
                // For now, let's rely on refreshFavoriteIconsInView for the main chat, and popup reopening for full refresh.
                // The original logic for updating the popup:
                // if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
                //     const context = getContext();
                //     if (String(currentViewingChatFile).replace('.jsonl','') === String(context.chatId || '').replace('.jsonl','')) {
                //         currentPage = 1; 
                //         updateFavoritesPopup(currentViewingChatFile); // currentViewingChatFile is state in popup.js
                //     }
                // }
                // This means the popup module needs to handle this internally or expose a targeted update function.
                // Let's assume `updateOpenFavoritesPopup(getContext().chatId.replace('.jsonl',''))` is smart enough.
                if (document.querySelector('#favorites-popup-content')) { // Basic check if popup is likely open
                    const currentActiveChatFile = getContext().chatId?.replace('.jsonl', '');
                    if (currentActiveChatFile) {
                         await updateOpenFavoritesPopup(currentActiveChatFile);
                    }
                }

                setTimeout(refreshFavoriteIconsInView, 100); // Refresh icons in main chat view
            }
        });

        const handleNewMessage = () => { setTimeout(addFavoriteIconsToMessages, 150); };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);

        const handleMessageUpdateOrSwipe = () => { setTimeout(refreshFavoriteIconsInView, 150); };
        eventSource.on(event_types.MESSAGE_SWIPED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MESSAGE_UPDATED, handleMessageUpdateOrSwipe);

        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => { 
            setTimeout(() => { 
                addFavoriteIconsToMessages(); 
                refreshFavoriteIconsInView(); 
            }, 150); 
        });

        // MutationObserver for dynamically loaded messages (e.g., scrolling up)
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                            needsIconAddition = true; break;
                        }
                    }
                }
                if (needsIconAddition) break;
            }
            if (needsIconAddition) { requestAnimationFrame(addFavoriteIconsToMessages); }
        });
        const chatElement = document.getElementById('chat');
        if (chatElement) { 
            chatObserver.observe(chatElement, { childList: true, subtree: true }); 
        } else { 
            console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`); 
        }

        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
