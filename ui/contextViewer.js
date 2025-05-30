// ui/contextViewer.js

import {
    getContext,
    messageFormatting,
} from '../../../../script.js'; // Adjust path
import { pluginName } from '../core/state.js';
import { getFullChatData } from '../core/chatIO.js';

// CSS for context viewer will be moved to style.css or injected by index.js

/**
 * Handles viewing the context of a specific message.
 * @param {string} messageId The mesid of the message to view.
 * @param {string} chatFileNoExt The filename (no ext) of the chat containing the message.
 * @param {Array} allChatsFavoritesDataCache The cache of all chat data.
 */
export async function handleViewContext(messageId, chatFileNoExt, allChatsFavoritesDataCache) {
    console.log(`${pluginName}: 查看消息 ${messageId} 的上下文，聊天文件: ${chatFileNoExt}`);

    try {
        const context = getContext();
        let messagesArray = [];

        const isCurrentChat = String(context.chatId || '').replace('.jsonl', '') === chatFileNoExt;

        if (isCurrentChat) {
            messagesArray = context.chat || [];
        } else {
            const chatData = allChatsFavoritesDataCache.find(c => 
                String(c.fileName).replace('.jsonl', '') === chatFileNoExt);

            if (chatData && Array.isArray(chatData.messages)) {
                messagesArray = chatData.messages;
            } else {
                const fullChatData = await getFullChatData(
                    context.characterId, 
                    context.groupId, 
                    chatFileNoExt, 
                    !!context.groupId
                );
                if (fullChatData && Array.isArray(fullChatData.messages)) {
                    messagesArray = fullChatData.messages;
                } else {
                    toastr.error('无法获取消息上下文的消息数据');
                    return;
                }
            }
        }

        const msgIndex = parseInt(messageId, 10);
        if (isNaN(msgIndex) || msgIndex < 0 || msgIndex >= messagesArray.length) {
            toastr.error(`消息索引无效: ${messageId}`);
            return;
        }

        const currentMessage = messagesArray[msgIndex];
        const prevMessage = (msgIndex > 0) ? messagesArray[msgIndex - 1] : null;
        const nextMessage = (msgIndex < messagesArray.length - 1) ? messagesArray[msgIndex + 1] : null;

        showContextMessagesFrame(prevMessage, currentMessage, nextMessage);

    } catch (error) {
        console.error(`${pluginName}: 查看消息上下文时出错:`, error);
        toastr.error('查看消息上下文时发生错误');
    }
}

function showContextMessagesFrame(prevMessage, currentMessage, nextMessage) {
    $('#context-messages-frame').remove();

    const frameHtml = `
        <div id="context-messages-frame" class="context-messages-frame">
            <div class="context-messages-container">
                <div class="context-messages-header">
                    <div class="context-title">消息上下文</div>
                    <div class="context-close-btn"><i class="fa-solid fa-xmark"></i></div>
                </div>
                <div class="context-messages-content"></div>
            </div>
        </div>
    `;
    $('body').append(frameHtml);

    const contentContainer = $('.context-messages-content');
    if (prevMessage) contentContainer.append(renderContextMessage(prevMessage, false));
    if (currentMessage) contentContainer.append(renderContextMessage(currentMessage, true));
    if (nextMessage) contentContainer.append(renderContextMessage(nextMessage, false));

    setTimeout(() => $('#context-messages-frame').addClass('visible'), 10);

    $('.context-close-btn').on('click', closeContextFrame);
    $(document).on('keydown.contextFrame', e => e.key === 'Escape' && closeContextFrame());
    $('#context-messages-frame').on('click', e => e.target === e.currentTarget && closeContextFrame());
}

function closeContextFrame() {
    const frame = $('#context-messages-frame');
    frame.removeClass('visible');
    setTimeout(() => {
        frame.remove();
        $(document).off('keydown.contextFrame');
    }, 300);
}

function renderContextMessage(message, isHighlighted) {
    if (!message) return '';

    const contextGlobal = getContext(); // For avatar paths
    const isUser = message.is_user;
    const senderName = message.name || (isUser ? (contextGlobal.userAlias || '用户') : '角色');
    let avatarImg = '';

    if (isUser) {
        // Try to get user avatar from settings if available, otherwise default
        avatarImg = मानव.头像 || 'User.png'; // SillyTavern often uses "Man.avatar" or similar for user avatar
        if (!avatarImg || avatarImg === 'undefined') avatarImg = 'User.png';
    } else {
        // For AI, try to get it from the current character context if the message is from them,
        // or fall back to message.avatar or a default.
        if (contextGlobal && contextGlobal.characterId !== undefined && contextGlobal.characters && 
            contextGlobal.characters[contextGlobal.characterId] && 
            (message.name === contextGlobal.characters[contextGlobal.characterId].name || !message.name) // Heuristic
        ) {
            avatarImg = contextGlobal.characters[contextGlobal.characterId].avatar;
        } else {
            avatarImg = message.avatar; // Fallback to avatar stored in message
        }
        if (!avatarImg || avatarImg === 'undefined') avatarImg = 'img/ai4.png'; // Default AI avatar
    }

    let formattedContent = message.mes || '[空消息]';
    try {
        // messageFormatting(text, name, isLast, isUser, profileUrl, Swipes, isEditing)
        formattedContent = messageFormatting(formattedContent, senderName, false, isUser, null, message.swipes || [], false);
    } catch (error) {
        console.error(`${pluginName}: 格式化消息内容时出错:`, error, message);
        formattedContent = `<div class="formatting-error">${message.mes || '[空消息]'} (格式化失败)</div>`;
    }

    const messageClass = isUser ? 'user-message' : 'ai-message';
    const highlightClass = isHighlighted ? 'highlighted-message' : '';

    return `
        <div class="context-message-wrapper ${messageClass} ${highlightClass}">
            <div class="context-message-avatar">
                <img src="${avatarImg}" alt="${senderName}" onerror="this.src='img/ai4.png'">
            </div>
            <div class="context-message-bubble">
                <div class="context-message-name">${senderName}</div>
                <div class="context-message-text">${formattedContent}</div>
            </div>
        </div>
    `;
}
