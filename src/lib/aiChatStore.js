// Storage and management for Motion AI chat sessions
const STORAGE_KEY = 'motion_ai_chats_v1';

function getDefaultChats() {
  const now = new Date();
  const sampleDate = new Date(now.getFullYear(), 3, 6); // Apr 6

  return [
    {
      id: 'chat-sample-1',
      title: 'Schema, Tables & Relationships Overview',
      createdAt: sampleDate.toISOString(),
      updatedAt: sampleDate.toISOString(),
      messages: [
        {
          id: 'msg-1',
          sender: 'user',
          text: 'Explain the database schema, core tables, and relationships in the project',
          timestamp: sampleDate.toISOString()
        },
        {
          id: 'msg-2',
          sender: 'ai',
          text: `Welcome! Here is a detailed overview of the core database schema and tables in the **Motion Workspace** project:

### 1. Users Table (\`users\`)
- Acts as an extension of Supabase Auth (\`auth.users\`).
- Fields: Identifier (\`id\`), Email (\`email\`), Name (\`name\`), and profile avatar (\`avatar_url\`).

### 2. Workspaces (\`workspaces\` & \`workspace_members\`)
- **\`workspaces\`**: Stores workspace ID, title/name, and owner identifier (\`owner_id\`).
- **\`workspace_members\`**: Manages member permissions with role levels (\`owner\`, \`admin\`, \`editor\`, \`commenter\`, \`viewer\`).

### 3. Pages & Notes (\`pages\`)
- Stores documents with hierarchical nested tree support via \`parent_id\`.
- Supports multiple types: (\`note\`, \`document\`, \`kanban\`, \`database\`).
- Contains rich structured document blocks as JSON (\`content\`).

### 4. Tasks Table (\`tasks\`)
- Powers the Kanban task board (\`kanban\`).
- Fields: Title (\`title\`), Status (\`status\`), Priority (\`priority\`), Assignee (\`assignee_id\`), and Due Date (\`due_date\`).

### 5. Team Chat Messages (\`team_chat_messages\`)
- Powers real-time messaging, file attachments, and image previews between members of each workspace.

Would you like more details on a specific table or Row Level Security (RLS) policies?`,
          timestamp: sampleDate.toISOString()
        }
      ]
    }
  ];
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
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : getDefaultChats();
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
