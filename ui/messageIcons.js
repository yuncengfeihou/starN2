// ui/messageIcons.js

import { getContext } from '../../../script.js'; 
import { pluginName } from '../core/state.js';
import { ensureFavoritesArrayExists, addFavorite, removeFavoriteById } from '../core/favoritesManager.js';

// Define HTML for the favorite toggle icon
export const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 */
export function addFavoriteIconsToMessages() {
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
export function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists(); // Always refers to the current active chat's metadata
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取当前激活聊天的有效 chatMetadata 或 favorites 数组`);
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }
    addFavoriteIconsToMessages(); // 确保结构存在
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid');
        if (messageId) {
            const isFavorited = chatMetadata.favorites.some(fav => fav.messageId === messageId);
            const iconElement = messageElement.find('.favorite-toggle-icon i');
            if (iconElement.length) {
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
}

/**
 * 处理收藏图标点击事件
 * @param {Event} event
 */
export async function handleFavoriteToggle(event) {
    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) return;

    const messageElement = target.closest('.mes');
    if (!messageElement || !messageElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 无法找到父级 .mes 元素`);
        return;
    }
    const messageIdString = messageElement.attr('mesid');
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 未找到 mesid 属性`);
        return;
    }

    let context;
    try {
        context = getContext();
    } catch (e) {
        console.error(`${pluginName}: handleFavoriteToggle - 调用 getContext() 时出错:`, e);
        return;
    }

    const currentChatMetadata = ensureFavoritesArrayExists();
    if (!currentChatMetadata) {
        console.error(`${pluginName}: handleFavoriteToggle - 无法获取当前激活聊天的元数据。`);
        return;
    }

    const messageIndex = parseInt(messageIdString, 10);
    const message = context.chat[messageIndex];
    if (!message) {
        console.error(`${pluginName}: handleFavoriteToggle - 在索引 ${messageIndex} 未找到消息对象 (来自当前激活聊天)。`);
        return;
    }

    const iconElement = target.find('i');
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');
    const currentChatIdNoExt = String(context.chatId || '').replace('.jsonl','');

    if (!isCurrentlyFavorited) {
        const messageInfo = {
            messageId: messageIdString,
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
        };
        // For addFavorite, it might need the popup's cache if it's modifying something not active
        // but for a direct message click, it's always the active chat.
        await addFavorite(messageInfo, currentChatIdNoExt); // Pass null for options as it's active chat
        iconElement.removeClass('fa-regular').addClass('fa-solid');
    } else {
        const favoriteToRemove = currentChatMetadata.favorites.find(fav => fav.messageId === messageIdString);
        if (favoriteToRemove) {
            // Similar to addFavorite, removeFavoriteById might need cache if not active chat.
            // Here, it's the active chat.
            await removeFavoriteById(favoriteToRemove.id, currentChatIdNoExt); // Pass null for options
            iconElement.removeClass('fa-solid').addClass('fa-regular');
        } else {
            console.warn(`${pluginName}: handleFavoriteToggle - 尝试移除但未在当前聊天元数据中找到收藏项, msgId: ${messageIdString}`);
            iconElement.removeClass('fa-solid').addClass('fa-regular');
        }
    }
}
