// ui/popup.js

import {
    getContext,
    messageFormatting,
    saveSettingsDebounced,
    timestampToMoment,
} from '../../../../script.js'; // Adjust path
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../../popup.js';
import { extension_settings } from '../../../../extensions.js';
import { pluginName } from '../core/state.js';
import { getAllChatFavoritesForCurrentContext } from '../core/chatIO.js';
import { removeFavoriteById, updateFavoriteNote, ensureFavoritesArrayExists } from '../core/favoritesManager.js';
import { handleExportFavorites, handleExportFavoritesJsonl, handleExportFavoritesWorldbook } from '../features/export.js';
import { handlePreviewButtonClick } from '../features/preview.js';
import { handleViewContext } from './contextViewer.js'; // Import for eye icon

// Store reference to the favorites popup
let favoritesPopup = null;
// Current pagination state
let currentPage = 1;
const itemsPerPage = 5;

// 当前查看的聊天文件状态管理
let currentViewingChatFile = null; // 当前在收藏夹中查看的是哪个聊天文件的收藏，不带 .jsonl
let allChatsFavoritesData = [];    // 缓存当前角色/群组的所有聊天及其收藏数据
let chatListScrollTop = 0;         // 保存聊天列表的滚动位置


/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination, relative to sorted array)
 * @param {Object | null} originalMessage The original message object from the chat, if available
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index, originalMessage = null) {
    if (!favItem) return '';

    let previewText = '';
    let deletedClass = '';
    let sendDateString = '';
    let senderName = favItem.sender || '未知发送者';
    let isUserMessage = favItem.role === 'user';

    if (originalMessage) {
        senderName = originalMessage.name || senderName;
        isUserMessage = originalMessage.is_user;

        if (originalMessage.send_date) {
            try {
                sendDateString = timestampToMoment(originalMessage.send_date).format('YYYY-MM-DD HH:mm:ss');
            } catch(e) {
                console.warn(`[${pluginName}] renderFavoriteItem: Failed to format timestamp ${originalMessage.send_date}`, e);
                sendDateString = String(originalMessage.send_date); // Fallback
            }
        } else {
            sendDateString = '[时间未知]';
        }

        if (originalMessage.mes) {
            previewText = originalMessage.mes;
            try {
                // messageFormatting(text, name, isLast, isUser, profileUrl, Swipes, isEditing)
                previewText = messageFormatting(previewText, senderName, false, isUserMessage, null, originalMessage.swipes || [], false);
            } catch (e) {
                 console.error(`${pluginName}: Error formatting message preview for favId ${favItem.id} (msgId ${favItem.messageId}):`, e);
                previewText = `[格式化失败] ${originalMessage.mes}`;
            }
        } else {
            previewText = '[消息内容为空]';
        }
    } else {
        previewText = '[原始消息内容不可用或已删除]';
        sendDateString = '[时间不可用]';
        deletedClass = 'deleted';
    }

    const formattedMesid = `# ${favItem.messageId}`;

    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-header-info">
                <div class="fav-send-date">
                    ${sendDateString}
                    <span class="fav-mesid" title="原始消息索引 (mesid)">${formattedMesid}</span>
                </div>
                <div class="fav-meta">${senderName}</div>
            </div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">${favItem.note || ''}</div>
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-eye" title="查看上下文"></i>
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data
 */
export async function updateFavoritesPopup(selectedChatFileName = null) {
    if (!favoritesPopup || !favoritesPopup.content) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready or content missing.`);
        return;
    }

    const context = getContext();
    const currentContextChatIdNoExt = String(context.chatId || '').replace('.jsonl', '');
    const selectedChatFileNameNoExt = selectedChatFileName ? String(selectedChatFileName).replace('.jsonl', '') : null;

    if (allChatsFavoritesData.length === 0 || (selectedChatFileNameNoExt && selectedChatFileNameNoExt !== currentViewingChatFile)) {
        favoritesPopup.content.innerHTML = '<div class="spinner"></div>';
        allChatsFavoritesData = await getAllChatFavoritesForCurrentContext();

        console.log(`${pluginName}: 已获取聊天文件列表:`, 
            allChatsFavoritesData.map(d => ({ fileName: d.fileName, displayName: d.displayName, favCount: d.favorites?.length })));

        if (allChatsFavoritesData.length === 0) {
            favoritesPopup.content.innerHTML = `<div class="favorites-empty">当前角色/群组没有聊天记录或无法加载收藏。</div>`;
            currentViewingChatFile = null;
            return;
        }
        currentViewingChatFile = selectedChatFileNameNoExt || currentContextChatIdNoExt || String(allChatsFavoritesData[0].fileName).replace('.jsonl','');
    } else if (selectedChatFileNameNoExt) {
        currentViewingChatFile = selectedChatFileNameNoExt;
    } else if (!currentViewingChatFile && allChatsFavoritesData.length > 0) {
        currentViewingChatFile = currentContextChatIdNoExt || String(allChatsFavoritesData[0].fileName).replace('.jsonl','');
    }

    currentViewingChatFile = String(currentViewingChatFile || '').replace('.jsonl', '');

    let viewingChatData = null;
    if (currentViewingChatFile) {
        viewingChatData = allChatsFavoritesData.find(chatData => 
            String(chatData.fileName).replace('.jsonl', '') === currentViewingChatFile);
    }
    if (!viewingChatData && currentContextChatIdNoExt && currentViewingChatFile !== currentContextChatIdNoExt) {
        viewingChatData = allChatsFavoritesData.find(chatData => 
            String(chatData.fileName).replace('.jsonl', '') === currentContextChatIdNoExt);
        if (viewingChatData) currentViewingChatFile = currentContextChatIdNoExt;
    }
    if (!viewingChatData && allChatsFavoritesData.length > 0) {
        viewingChatData = allChatsFavoritesData[0];
        currentViewingChatFile = String(viewingChatData.fileName).replace('.jsonl', '');
    }

    if (!viewingChatData) {
        favoritesPopup.content.innerHTML = `<div class="favorites-empty">无法加载选定聊天的收藏。</div>`;
        console.error(`${pluginName}: updateFavoritesPopup - Could not find data for chat ${currentViewingChatFile}`);
        return;
    }

    const actualChatMetadata = viewingChatData.metadata;
    const favoritesArray = actualChatMetadata.favorites || [];
    let entityDisplayName = '未知实体';
    if (context.groupId) {
        const group = context.groups?.find(g => g.id === context.groupId);
        entityDisplayName = group ? group.name : `群组 ${context.groupId}`;
    } else if (context.characterId !== undefined) {
        entityDisplayName = context.name2 || `角色 ${context.characterId}`;
    }

    const totalFavorites = favoritesArray.length;
    const sortedFavorites = [...favoritesArray].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let chatListHtml = '<div class="favorites-chat-list-header">聊天列表</div><div class="favorites-chat-list-items">';
    allChatsFavoritesData.forEach(chat => {
        const fileNameNoExt = String(chat.fileName).replace('.jsonl', '');
        const isActive = fileNameNoExt === currentViewingChatFile;
        const displayName = chat.displayName || fileNameNoExt;
        const storageKeyEntityId = context.characterId !== undefined ? context.characterId : context.groupId;
        const chatNote = extension_settings[pluginName]?.chatNotes?.[`${storageKeyEntityId}_${fileNameNoExt}`] || '';
        const favCount = chat.favorites?.length || 0;
        const displayTitle = chatNote ? `备注: ${chatNote}\n点击查看此聊天的收藏` : `点击查看 "${displayName}" 的收藏`;

        chatListHtml += `
            <div class="favorites-chat-list-item ${isActive ? 'active' : ''}"
                 data-chat-file="${fileNameNoExt}"
                 title="${displayTitle}">
                <span class="chat-list-item-name">${displayName}</span>
                ${chatNote ? `<span class="chat-list-item-note-indicator" title="有备注"><i class="fa-solid fa-note-sticky fa-xs"></i></span>` : ''}
                <span class="chat-list-item-fav-count">(${favCount})</span>
            </div>`;
    });
    chatListHtml += '</div>';

    let exportButtonHtml = '';
    if (totalFavorites > 0) {
        exportButtonHtml = `
            <div class="favorites-export-dropdown">
                <button id="export-favorites-trigger-btn" class="menu_button" title="选择导出格式">
                    导出收藏 <i class="fa-solid fa-caret-down"></i>
                </button>
                <ul id="favorites-export-menu" class="favorites-export-options" style="display: none;">
                    <li id="export-favorites-txt-item" class="favorites-export-item">导出为 TXT</li>
                    <li id="export-favorites-jsonl-item" class="favorites-export-item">导出为 JSONL</li>
                    <li id="export-favorites-worldbook-item" class="favorites-export-item">导出为世界书 (JSON)</li>
                </ul>
            </div>
        `;
    }

    const viewingChatDisplayName = viewingChatData.displayName || currentViewingChatFile;
    let favoritesPanelHtml = `
        <div class="favorites-panel-header">
            <h3>${entityDisplayName} - 聊天: "${viewingChatDisplayName}" (${totalFavorites} 条收藏)</h3>
                <div class="favorites-header-buttons">
                    ${exportButtonHtml}
                ${totalFavorites > 0 ? `<button class="menu_button preview-favorites-btn" title="在新聊天中预览当前选中聊天的所有收藏的消息">预览选中聊天收藏</button>` : ''}
                </div>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        favoritesPanelHtml += `<div class="favorites-empty">此聊天没有收藏的消息。</div>`;
    } else {
        const originalChatMessages = viewingChatData.messages || [];
        currentPageItems.forEach((favItem, index) => {
            if (favItem) {
                const messageIndex = parseInt(favItem.messageId, 10);
                let messageForRender = null;
                if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChatMessages.length) {
                    messageForRender = originalChatMessages[messageIndex];
                }
                favoritesPanelHtml += renderFavoriteItem(favItem, startIndex + index, messageForRender);
            }
        });
        if (totalPages > 1) {
            favoritesPanelHtml += `<div class="favorites-pagination">`;
            favoritesPanelHtml += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            favoritesPanelHtml += `<span>${currentPage} / ${totalPages}</span>`;
            favoritesPanelHtml += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            favoritesPanelHtml += `</div>`;
        }
    }
    favoritesPanelHtml += `</div>`;
    favoritesPanelHtml += `<div class="favorites-footer"></div>`;

    const finalContentHtml = `
        <div id="favorites-popup-content" class="favorites-container">
            <div class="favorites-chat-list-panel">
                ${chatListHtml}
            </div>
            <div class="favorites-main-panel">
                ${favoritesPanelHtml}
            </div>
        </div>
    `;

    try {
        favoritesPopup.content.innerHTML = finalContentHtml;
        const chatListItemsContainer = favoritesPopup.content.querySelector('.favorites-chat-list-items');
        if (chatListItemsContainer) {
            chatListItemsContainer.scrollTop = chatListScrollTop;
        }
    } catch (error) {
         console.error(`${pluginName}: Error setting popup innerHTML:`, error);
    }
    // Debug logs removed for brevity, they are good for development
}

async function handleDeleteFavoriteFromPopup(favId, messageId, targetChatFile) {
    const chatFileForDeletion = targetChatFile ? String(targetChatFile).replace('.jsonl','') : currentViewingChatFile;
    console.log(`[${pluginName}] 尝试从${chatFileForDeletion ? '指定聊天' : '当前聊天'} ${chatFileForDeletion || '(未指定)'} 中删除收藏: favId=${favId}, messageId=${messageId}`);

    try {
        const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);
        if (confirmResult === POPUP_RESULT.AFFIRMATIVE) {
            // Pass allChatsFavoritesData for cache update if deleting from non-active chat
            const removed = await removeFavoriteById(favId, chatFileForDeletion, { allChatsFavoritesDataCache: allChatsFavoritesData, currentViewingChatFileInPopup: currentViewingChatFile });
            if (removed) {
                await updateFavoritesPopup(currentViewingChatFile);

                const context = getContext();
                if (String(chatFileForDeletion).replace('.jsonl','') === String(context.chatId || '').replace('.jsonl','')) {
                    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                    if (messageElement.length) {
                        const iconElement = messageElement.find('.favorite-toggle-icon i');
                        if (iconElement.length) {
                            iconElement.removeClass('fa-solid').addClass('fa-regular');
                        }
                    }
                }
                toastr.success('收藏已删除');
            } else {
                toastr.error('删除收藏失败');
            }
        }
    } catch (error) {
        console.error(`[${pluginName}] 删除收藏过程中出错 (favId: ${favId}, chatFile: ${chatFileForDeletion}):`, error);
        toastr.error('删除收藏时发生错误');
    }
}

async function handleEditNote(favId, targetChatFile) {
    const chatFileToModify = targetChatFile ? String(targetChatFile).replace('.jsonl','') : currentViewingChatFile;
    console.log(`[${pluginName}] 编辑聊天 ${chatFileToModify} 中收藏项 ${favId} 的备注`);

    let favorite = null;
    let currentNote = '';

    if (chatFileToModify && allChatsFavoritesData.length > 0) {
        const chatData = allChatsFavoritesData.find(c => 
            String(c.fileName).replace('.jsonl','') === chatFileToModify);

        if (chatData?.metadata?.favorites) {
            favorite = chatData.metadata.favorites.find(fav => fav.id === favId);
            if (favorite) {
                currentNote = favorite.note || '';
            }
        }
    }

    if (!favorite) {
        // If not found in cache, and it's the current active chat, try to get from ensureFavoritesArrayExists
        const context = getContext();
        if(chatFileToModify === String(context.chatId || '').replace('.jsonl', '')) {
            const activeChatMeta = ensureFavoritesArrayExists();
            if (activeChatMeta && activeChatMeta.favorites) {
                 favorite = activeChatMeta.favorites.find(fav => fav.id === favId);
                 if (favorite) currentNote = favorite.note || '';
            }
        }
        if (!favorite) { // Still not found
            console.warn(`[${pluginName}] 未找到要编辑的收藏项 ID=${favId}, 聊天=${chatFileToModify}`);
            toastr.error('无法找到收藏项');
            return;
        }
    }

    const result = await callGenericPopup('为这条收藏添加备注:', POPUP_TYPE.INPUT, currentNote);
    if (result !== null && result !== POPUP_RESULT.CANCELLED) {
        // Pass allChatsFavoritesData for cache update if editing non-active chat
        await updateFavoriteNote(favId, result, chatFileToModify, { allChatsFavoritesDataCache: allChatsFavoritesData, currentViewingChatFileInPopup: currentViewingChatFile });
        await updateFavoritesPopup(currentViewingChatFile);
        toastr.success('收藏备注已更新');
    }
}


/**
 * Opens or updates the favorites popup
 */
export async function showFavoritesPopup() {
    if (!favoritesPopup) {
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>',
                POPUP_TYPE.TEXT,
                '',
                {
                    title: '收藏管理', wide: true, wider: true, large: true,
                    okButton: false, cancelButton: true, allowVerticalScrolling: true,
                    onClose: () => {
                        allChatsFavoritesData = [];
                        currentViewingChatFile = null;
                        chatListScrollTop = 0;
                        console.log(`${pluginName}: Favorites popup closed, cache cleared.`);
                    }
                }
            );

            $(favoritesPopup.content).on('click', async function(event) {
                const target = $(event.target);
                const closestButton = target.closest('button');
                const closestMenuItem = target.closest('.favorites-export-item');
                const closestChatListItem = target.closest('.favorites-chat-list-item');

                if (closestChatListItem.length) {
                    const chatFile = String(closestChatListItem.data('chat-file')).replace('.jsonl','');
                    if (chatFile && chatFile !== currentViewingChatFile) {
                        chatListScrollTop = closestChatListItem.parent().scrollTop();
                        currentPage = 1;
                        await updateFavoritesPopup(chatFile);
                    }
                    return;
                }

                if (closestButton.length && closestButton.attr('id') === 'export-favorites-trigger-btn') {
                    $('#favorites-export-menu').toggle();
                    return;
                }

                if (closestMenuItem.length) {
                    const menuItemId = closestMenuItem.attr('id');
                    $('#favorites-export-menu').hide();
                    const chatFileForExport = currentViewingChatFile;

                    const viewingChatData = allChatsFavoritesData.find(c => String(c.fileName).replace('.jsonl', '') === chatFileForExport);
                    if (!viewingChatData) {
                        toastr.error(`无法找到聊天 "${chatFileForExport}" 的数据进行导出。`);
                        return;
                    }
                    const contextGlobal = getContext();
                    let entityChatName = viewingChatData.displayName || chatFileForExport;
                    if (viewingChatData.isGroup) {
                         const group = contextGlobal.groups?.find(g => g.id === viewingChatData.groupId);
                         entityChatName = `${group ? group.name : '群组'} (聊天: ${viewingChatData.displayName || chatFileForExport})`;
                    } else {
                         entityChatName = `${contextGlobal.name2 || '角色'} (聊天: ${viewingChatData.displayName || chatFileForExport})`;
                    }


                    if (menuItemId === 'export-favorites-txt-item') {
                        await handleExportFavorites(chatFileForExport, viewingChatData.metadata, viewingChatData.messages, entityChatName, contextGlobal);
                    } else if (menuItemId === 'export-favorites-jsonl-item') {
                        await handleExportFavoritesJsonl(chatFileForExport, viewingChatData.metadata, viewingChatData.messages, entityChatName, contextGlobal);
                    } else if (menuItemId === 'export-favorites-worldbook-item') {
                        await handleExportFavoritesWorldbook(chatFileForExport, viewingChatData.metadata, viewingChatData.messages, entityChatName);
                    }
                    return;
                }

                if (!target.closest('.favorites-export-dropdown').length) {
                     $('#favorites-export-menu').hide();
                }

                if (closestButton.length) {
                    if (closestButton.hasClass('pagination-prev')) {
                         if (currentPage > 1) { currentPage--; await updateFavoritesPopup(currentViewingChatFile); }
                    } else if (closestButton.hasClass('pagination-next')) {
                        const viewingChatData = allChatsFavoritesData.find(c => String(c.fileName).replace('.jsonl','') === currentViewingChatFile);
                        const totalFavorites = viewingChatData?.favorites?.length || 0;
                        const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                        if (currentPage < totalPages) { currentPage++; await updateFavoritesPopup(currentViewingChatFile); }
                    } else if (closestButton.hasClass('preview-favorites-btn')) {
                        await handlePreviewButtonClick(currentViewingChatFile, allChatsFavoritesData); // Pass cache
                        if (favoritesPopup) favoritesPopup.completeCancelled(); // Close popup
                    }
                } 
                else if (target.hasClass('fa-eye')) {
                    const favItemEl = target.closest('.favorite-item');
                    if (favItemEl.length) {
                        // Pass allChatsFavoritesData for context viewer
                        await handleViewContext(favItemEl.data('msg-id'), currentViewingChatFile, allChatsFavoritesData);
                    }
                    return; // prevent menu hide
                } else if (target.hasClass('fa-pencil')) {
                    const favItemEl = target.closest('.favorite-item');
                    if (favItemEl.length) {
                        await handleEditNote(favItemEl.data('fav-id'), currentViewingChatFile);
                    }
                } else if (target.hasClass('fa-trash')) {
                    const favItemEl = target.closest('.favorite-item');
                    if (favItemEl.length) {
                        await handleDeleteFavoriteFromPopup(favItemEl.data('fav-id'), favItemEl.data('msg-id'), currentViewingChatFile);
                    }
                }
            });

            $(favoritesPopup.content).on('contextmenu pointerdown', '.favorites-chat-list-item', function(event) {
                const listItem = $(this);
                const chatFileNoExt = String(listItem.data('chat-file')).replace('.jsonl','');
                const context = getContext();
                const storageKeyEntityId = context.characterId !== undefined ? context.characterId : context.groupId;
                const storageKey = `${storageKeyEntityId}_${chatFileNoExt}`;

                if (event.type === 'contextmenu' || (event.type === 'pointerdown' && event.originalEvent.pointerType === 'touch')) {
                    event.preventDefault();
                    const pressTimer = setTimeout(async () => {
                        if (!extension_settings[pluginName].chatNotes) extension_settings[pluginName].chatNotes = {};
                        const currentNote = extension_settings[pluginName].chatNotes[storageKey] || '';
                        const newNote = await callGenericPopup(
                            `为聊天 "${listItem.find('.chat-list-item-name').text()}" 添加/编辑备注:`,
                            POPUP_TYPE.INPUT, currentNote, { rows: 3 }
                        );
                        if (newNote !== null && newNote !== POPUP_RESULT.CANCELLED) {
                            extension_settings[pluginName].chatNotes[storageKey] = newNote.trim();
                            saveSettingsDebounced();
                            chatListScrollTop = listItem.parent().scrollTop(); // Save scroll before update
                            await updateFavoritesPopup(currentViewingChatFile); // This will re-render
                            toastr.success('聊天备注已更新!');
                        }
                    }, event.type === 'pointerdown' ? 700 : 0); // For touch, add delay
                    if (event.type === 'pointerdown') {
                        listItem.one('pointerup pointercancel', () => clearTimeout(pressTimer));
                    }
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null;
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
         $('#favorites-export-menu').hide();
    }

    currentPage = 1;
    allChatsFavoritesData = []; // Force reload
    currentViewingChatFile = null;

    await updateFavoritesPopup(); // Initial load

    if (favoritesPopup) {
        try {
            favoritesPopup.show();
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
        }
    }
}
