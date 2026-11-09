// Storage and management for Motion AI chat sessions
const STORAGE_KEY = 'motion_ai_chats_v1';

// No fake sample conversations: a new user starts with an empty, helpful screen.
function getDefaultChats() {
  return [];
}

export function getStoredChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaults = getDefaultChats();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    // Drop the old built-in sample chat that earlier versions stored.
    return Array.isArray(parsed) ? parsed.filter((chat) => chat?.id !== 'chat-sample-1') : getDefaultChats();
  } catch {
    return getDefaultChats();
  }
}

export function saveStoredChats(chats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    window.dispatchEvent(new CustomEvent('motion:ai-chats-updated', { detail: chats }));
  } catch (err) {
    console.error('Failed to save AI chats to localStorage:', err);
  }
}

export function createNewAIChat(title = 'New chat') {
  const chats = getStoredChats();
  const newChat = {
    id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  const updated = [newChat, ...chats];
  saveStoredChats(updated);
  return newChat;
}

export function addMessageToChat(chatId, message) {
  const chats = getStoredChats();
  const chatIndex = chats.findIndex((c) => c.id === chatId);
  if (chatIndex === -1) return null;

  const chat = chats[chatIndex];
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...message
  };

  chat.messages.push(newMsg);
  chat.updatedAt = new Date().toISOString();

  // Auto-generate title from first user message if still default
  if (chat.title === 'New chat' && message.sender === 'user') {
    const cleanTitle = message.text.trim().split('\n')[0].substring(0, 32);
    if (cleanTitle) chat.title = cleanTitle;
  }

  // Move updated chat to front
  chats.splice(chatIndex, 1);
  chats.unshift(chat);

  saveStoredChats(chats);
  return chat;
}

export function updateMessageInChat(chatId, messageId, patch) {
  const chats = getStoredChats();
  const chat = chats.find((item) => item.id === chatId);
  const message = chat?.messages.find((item) => item.id === messageId);
  if (!message) return null;
  Object.assign(message, patch);
  saveStoredChats(chats);
  return message;
}

export function deleteAIChat(chatId) {
  const chats = getStoredChats();
  const filtered = chats.filter((c) => c.id !== chatId);
  saveStoredChats(filtered);
  return filtered;
}

export function formatChatDate(isoString) {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return 'Recent';
  }
}
