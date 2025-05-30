// core/state.js

export const pluginName = 'star'; // 保持文件夹名称一致

// --- 新增：预览状态管理 ---
export const previewState = {
    isActive: false,
    originalContext: null, // { characterId: string|null, groupId: string|null, chatId: string }
    previewChatId: null,   // 预览聊天的 ID
};

export const returnButtonId = 'favorites-return-button'; // 返回按钮的 ID
