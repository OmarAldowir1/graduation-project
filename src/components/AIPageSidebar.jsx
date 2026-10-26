import { useState, useEffect, useRef } from 'react';
import NotionAIFace from './NotionAIFace.jsx';
import {
  getStoredChats,
  createNewAIChat,
  addMessageToChat,
  deleteAIChat
} from '../lib/aiChatStore.js';
import { chatWithMotionAI } from '../lib/motionAI.js';
import { parseAttachedDocument } from '../lib/documentParser.js';
import {
  getActiveEditor,
  subscribeToActiveEditor,
  markdownToEditorHtml,
  applyAIToPage
} from '../lib/aiEditorBridge.js';
import { showToast } from '../legacy/app.js';

function renderMarkdownSnippet(text) {
  if (!text) return null;

  // Split into code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const firstLineBreak = part.indexOf('\n');
      const lang = firstLineBreak !== -1 ? part.slice(3, firstLineBreak).trim() : '';
      const code = firstLineBreak !== -1 ? part.slice(firstLineBreak + 1, -3) : part.slice(3, -3);

      return (
        <div key={index} className="my-2.5 rounded-lg overflow-hidden border border-outline-variant/30 bg-[#1e1e1e] text-stone-100 text-xs">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] text-stone-300 border-b border-white/5 font-mono text-[11px]">
            <span>{lang || 'code'}</span>
            <button
              type="button"
              className="hover:text-white transition-colors"
              onClick={() => {
                navigator.clipboard.writeText(code);
                showToast('Code copied to clipboard', 'success');
              }}
            >
              Copy
            </button>
          </div>
          <pre className="p-3 overflow-x-auto font-mono leading-relaxed">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    // Process lines
    const lines = part.split('\n');
    return (
      <div key={index} className="space-y-1.5 leading-relaxed text-xs">
        {lines.map((line, lIdx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('#### ')) {
            return <h5 key={lIdx} className="font-bold text-xs mt-2.5 mb-1 text-on-surface">{trimmed.slice(5)}</h5>;
          }
          if (trimmed.startsWith('### ')) {
            return <h4 key={lIdx} className="font-bold text-sm mt-3 mb-1 text-on-surface">{trimmed.slice(4)}</h4>;
          }
          if (trimmed.startsWith('## ')) {
            return <h3 key={lIdx} className="font-bold text-base mt-3.5 mb-1 text-on-surface">{trimmed.slice(3)}</h3>;
          }
          if (trimmed.startsWith('# ')) {
            return <h2 key={lIdx} className="font-bold text-lg mt-4 mb-1.5 text-on-surface">{trimmed.slice(2)}</h2>;
          }
          if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
            return (
              <li key={lIdx} className="ml-4 list-disc text-on-surface-variant">
                {formatInline(trimmed.replace(/^[-*•]\s+/, ''))}
              </li>
            );
          }
          if (/^\d+\.\s/.test(trimmed)) {
            return (
              <p key={lIdx} className="text-on-surface-variant font-medium ml-2">
                {formatInline(trimmed)}
              </p>
            );
          }
          if (!trimmed) {
            return <div key={lIdx} className="h-1.5" />;
          }
          return <p key={lIdx} className="text-on-surface-variant">{formatInline(line)}</p>;
        })}
      </div>
    );
  });
}

function formatInline(str) {
  if (!str) return '';
  const tokens = str.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={i} className="font-bold text-on-surface">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-surface-container-high font-mono text-[11px] text-primary font-semibold">
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}

export default function AIPageSidebar({
  isOpen,
  onClose,
  workspace,
  user
}) {
  const [chats, setChats] = useState(getStoredChats);
  const [activeChatId, setActiveChatId] = useState(() => chats[0]?.id || null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [fileError, setFileError] = useState('');
  const [activeEditor, setActiveEditor] = useState(getActiveEditor);
  const [showChatDropdown, setShowChatDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [includePageContext, setIncludePageContext] = useState(true);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Subscribe to active editor changes
  useEffect(() => {
    return subscribeToActiveEditor((editor) => {
      setActiveEditor(editor);
    });
  }, []);

  // Sync chats from local storage
  useEffect(() => {
    function handleStorage() {
      setChats(getStoredChats());
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowChatDropdown(false);
        setShowMoreMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentChat = chats.find((c) => c.id === activeChatId) || chats[0] || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages, isGenerating]);

  function handleStartNewChat() {
    const newChat = createNewAIChat('New AI chat');
    setChats(getStoredChats());
    setActiveChatId(newChat.id);
    setAttachedFile(null);
    setFileError('');
    setShowChatDropdown(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function handleSelectChat(id) {
    setActiveChatId(id);
    setShowChatDropdown(false);
  }

  function handleDeleteCurrentChat() {
    if (!currentChat) return;
    deleteAIChat(currentChat.id);
    const updated = getStoredChats();
    setChats(updated);
    setActiveChatId(updated[0]?.id || null);
    setShowMoreMenu(false);
    showToast('Chat history deleted', 'success');
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setIsParsingFile(true);

    try {
      const parsedDoc = await parseAttachedDocument(file);
      setAttachedFile(parsedDoc);
      if (!inputText.trim()) {
        setInputText(`Please read and analyze "${file.name}" and summarize its key insights.`);
      }
    } catch (err) {
      console.error('File parsing error:', err);
      setFileError(err.message || 'Failed to read document.');
    } finally {
      setIsParsingFile(false);
      e.target.value = '';
    }
  }

  async function handleSendMessage(customPrompt = '', overrideFile = null) {
    const promptToSend = (customPrompt || inputText).trim();
    const fileToUpload = overrideFile !== null ? overrideFile : attachedFile;

    if (!promptToSend && !fileToUpload) return;
    if (isGenerating || isParsingFile) return;

    let targetChatId = currentChat?.id;
    if (!targetChatId) {
      const pageTitle = activeEditor?.getTitle?.() || 'Page';
      const newChat = createNewAIChat(`Chat: ${pageTitle}`);
      targetChatId = newChat.id;
      setActiveChatId(newChat.id);
      setChats(getStoredChats());
    }

    const messageText = promptToSend || (fileToUpload ? `Please analyze "${fileToUpload.name}".` : '');

    // Add user message
    addMessageToChat(targetChatId, {
      sender: 'user',
      text: messageText,
      fileName: fileToUpload?.name || null,
      fileType: fileToUpload?.fileType || null
    });

    setChats(getStoredChats());
    setInputText('');
    setAttachedFile(null);
    setIsGenerating(true);

    try {
      // Gather active page context if requested
      const pageContext = (includePageContext && activeEditor) ? {
        title: activeEditor.getTitle?.() || 'Untitled',
        text: activeEditor.getText?.() || '',
        html: activeEditor.getHtml?.() || ''
      } : null;

      const chatHistory = currentChat?.messages || [];

      const aiReply = await chatWithMotionAI({
        messages: chatHistory,
        newUserPrompt: messageText,
        attachedFile: fileToUpload,
        workspaceContext: workspace,
        pageContext
      });

      addMessageToChat(targetChatId, {
        sender: 'ai',
        text: aiReply
      });

      setChats(getStoredChats());
    } catch (err) {
      console.error('AI error:', err);
      addMessageToChat(targetChatId, {
        sender: 'ai',
        text: `### AI Assistant Notice\n${err.message || 'AI is unavailable. Please try again later.'}`
      });
      setChats(getStoredChats());
    } finally {
      setIsGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  // Quick Action handlers (image 2)
  function handleSummarizePage() {
    const pageTitle = activeEditor?.getTitle?.() || 'this page';
    handleSendMessage(`Summarize the content of ${pageTitle} clearly with key highlights and actionable takeaways.`);
  }

  function handleTranslatePage() {
    const pageTitle = activeEditor?.getTitle?.() || 'this page';
    handleSendMessage(`Translate the content of ${pageTitle} completely into English. Provide a clean, natural English version preserving headings, bullet points, and structure.`);
  }

  function handleAnalyzePage() {
    const pageTitle = activeEditor?.getTitle?.() || 'this page';
    handleSendMessage(`Analyze ${pageTitle} for core insights, potential gaps, key themes, and recommended next steps.`);
  }

  function handleCreateTaskTracker() {
    const pageTitle = activeEditor?.getTitle?.() || 'this page';
    handleSendMessage(`Based on ${pageTitle}, generate an actionable task tracker table and checklist with Task, Priority, and Status.`);
  }

  // Page manipulation actions
  async function handleApplyToPage(aiText, mode = 'append') {
    try {
      const html = markdownToEditorHtml(aiText);
      await applyAIToPage({ html, mode });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (!isOpen) return null;

  const pageTitle = activeEditor?.getTitle?.() || 'Untitled Page';
  const hasMessages = currentChat?.messages && currentChat.messages.length > 0;

  return (
    <aside
      className="w-[380px] sm:w-[420px] flex-shrink-0 flex flex-col h-full bg-surface-container-lowest border-l border-outline-variant/20 shadow-xl z-30 transition-all select-none"
      aria-label="AI Chat Sidebar"
    >
      {/* Top Header */}
      <header className="flex items-center justify-between px-3.5 py-2.5 border-b border-outline-variant/15 bg-surface" ref={dropdownRef}>
        <div className="flex items-center gap-2 relative">
          <NotionAIFace size={22} />
          <button
            type="button"
            onClick={() => setShowChatDropdown((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-on-surface hover:text-primary transition-colors py-1 px-1.5 rounded-md hover:bg-surface-container-high"
            title="Switch or view chats"
          >
            <span className="truncate max-w-[130px]">{currentChat?.title || 'New AI chat'}</span>
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          {/* Chat History Dropdown */}
          {showChatDropdown && (
            <div className="absolute top-9 left-0 w-64 max-h-72 overflow-y-auto bg-surface border border-outline-variant/30 rounded-xl shadow-lg p-1.5 z-50">
              <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-on-surface-variant/70 border-b border-outline-variant/10 mb-1">
                <span>Recent Chats</span>
                <button
                  type="button"
                  onClick={handleStartNewChat}
                  className="text-primary hover:underline text-[11px] flex items-center gap-0.5"
                >
                  <span className="material-symbols-outlined text-xs">add</span> New
                </button>
              </div>
              {chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectChat(c.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs truncate flex items-center justify-between group transition-colors ${
                    c.id === currentChat?.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-surface-container-high text-on-surface'
                  }`}
                >
                  <span className="truncate">{c.title || 'Untitled chat'}</span>
                  {c.id === currentChat?.id && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top Right Action Icons */}
        <div className="flex items-center gap-1 text-on-surface-variant">
          <button
            type="button"
            onClick={handleStartNewChat}
            className="w-7 h-7 rounded-md hover:bg-surface-container-high flex items-center justify-center transition-colors"
            title="Start new chat (+)"
            aria-label="New chat"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
          </button>

          <button
            type="button"
            onClick={() => setIncludePageContext((v) => !v)}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              includePageContext ? 'text-primary bg-primary/10' : 'hover:bg-surface-container-high'
            }`}
            title={includePageContext ? 'Active page context linked' : 'Link active page context'}
            aria-label="Toggle page context"
          >
            <span className="material-symbols-outlined text-[17px]">dock_to_left</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu((v) => !v)}
              className="w-7 h-7 rounded-md hover:bg-surface-container-high flex items-center justify-center transition-colors"
              title="More actions"
              aria-label="More options"
            >
              <span className="material-symbols-outlined text-[17px]">more_horiz</span>
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-8 w-44 bg-surface border border-outline-variant/30 rounded-xl shadow-lg p-1.5 z-50">
                <button
                  type="button"
                  onClick={handleDeleteCurrentChat}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Delete Chat
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-surface-container-high flex items-center justify-center transition-colors"
            title="Collapse sidebar"
            aria-label="Close sidebar"
          >
            <span className="material-symbols-outlined text-[18px]">keyboard_double_arrow_right</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!hasMessages ? (
          /* Empty / Hero State (Matching Image 2) */
          <div className="flex flex-col items-center justify-center min-h-[70%] text-center pt-8 px-2">
            <NotionAIFace size={56} className="mb-4" />
            <h2 className="text-base sm:text-lg font-bold text-on-surface mb-6">
              How can I help you today?
            </h2>

            {/* Quick Action Suggestion Buttons (Image 2) */}
            <div className="w-full space-y-2 text-left">
              <button
                type="button"
                onClick={handleSummarizePage}
                disabled={isGenerating}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-outline-variant/25 bg-surface hover:bg-surface-container-high text-xs font-medium text-on-surface transition-all group shadow-2xs"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant group-hover:text-primary transition-colors">
                  notes
                </span>
                <span>Summarize this page</span>
              </button>

              <button
                type="button"
                onClick={handleTranslatePage}
                disabled={isGenerating}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-outline-variant/25 bg-surface hover:bg-surface-container-high text-xs font-medium text-on-surface transition-all group shadow-2xs"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant group-hover:text-primary transition-colors">
                  translate
                </span>
                <span>Translate this page</span>
              </button>

              <button
                type="button"
                onClick={handleAnalyzePage}
                disabled={isGenerating}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-outline-variant/25 bg-surface hover:bg-surface-container-high text-xs font-medium text-on-surface transition-all group shadow-2xs"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant group-hover:text-primary transition-colors">
                  manage_search
                </span>
                <span>Analyze for insights</span>
              </button>

              <button
                type="button"
                onClick={handleCreateTaskTracker}
                disabled={isGenerating}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-outline-variant/25 bg-surface hover:bg-surface-container-high text-xs font-medium text-on-surface transition-all group shadow-2xs"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant group-hover:text-primary transition-colors">
                  check_circle
                </span>
                <span>Create a task tracker</span>
              </button>
            </div>
          </div>
        ) : (
          /* Message Flow */
          <div className="space-y-4">
            {currentChat.messages.map((msg, idx) => {
              const isUser = msg.sender === 'user';
              return (
                <div key={idx} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  {isUser ? (
                    <div className="max-w-[88%] bg-primary text-on-primary rounded-2xl rounded-tr-xs px-3.5 py-2 text-xs leading-relaxed shadow-2xs">
                      {msg.fileName && (
                        <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold opacity-90 pb-1 border-b border-white/20">
                          <span className="material-symbols-outlined text-xs">attach_file</span>
                          <span className="truncate">{msg.fileName}</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  ) : (
                    <div className="w-full bg-surface border border-outline-variant/25 rounded-2xl rounded-tl-xs p-3.5 shadow-2xs space-y-3">
                      <div className="flex items-center gap-2">
                        <NotionAIFace size={20} />
                        <span className="text-[11px] font-bold text-on-surface">Motion AI</span>
                        <span className="text-[10px] text-on-surface-variant/60 font-medium ml-auto">Workers AI Free</span>
                      </div>

                      <div className="text-xs text-on-surface space-y-2">
                        {renderMarkdownSnippet(msg.text)}
                      </div>

                      {/* Control Page Actions for this AI Response */}
                      <div className="pt-2.5 border-t border-outline-variant/15 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleApplyToPage(msg.text, 'replace')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold transition-colors"
                          title="Replace entire active page with this AI content"
                        >
                          <span className="material-symbols-outlined text-xs">sync</span>
                          Replace page
                        </button>

                        <button
                          type="button"
                          onClick={() => handleApplyToPage(msg.text, 'append')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-[11px] font-medium transition-colors"
                          title="Insert this content at the end of the page"
                        >
                          <span className="material-symbols-outlined text-xs">add</span>
                          Insert into page
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(msg.text);
                            showToast('Response copied to clipboard', 'success');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-container-high text-on-surface-variant text-[11px] transition-colors ml-auto"
                          title="Copy text"
                        >
                          <span className="material-symbols-outlined text-xs">content_copy</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {isGenerating && (
              <div className="w-full bg-surface border border-outline-variant/25 rounded-2xl rounded-tl-xs p-3 flex items-center gap-2 text-xs text-on-surface-variant">
                <NotionAIFace size={18} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.4s]"></span>
                <span className="text-[11px] ml-1 font-medium">Motion AI is thinking...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Bottom Input Area (Image 2) */}
      <footer className="p-3 border-t border-outline-variant/15 bg-surface">
        {/* Active Page Indicator */}
        {includePageContext && activeEditor && (
          <div className="flex items-center justify-between text-[11px] text-on-surface-variant/75 mb-2 px-1">
            <span className="flex items-center gap-1 truncate max-w-[280px]">
              <span className="material-symbols-outlined text-xs text-primary">description</span>
              Active page: <strong className="text-on-surface truncate">{pageTitle}</strong>
            </span>
            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-medium shrink-0">
              Connected
            </span>
          </div>
        )}

        {/* Attached file chip */}
        {attachedFile && (
          <div className="flex items-center justify-between p-2 mb-2 rounded-lg bg-surface-container-high text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <span className="material-symbols-outlined text-sm text-primary">attach_file</span>
              <span className="truncate font-medium">{attachedFile.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="hover:text-red-500"
              title="Remove file"
            >
              <span className="material-symbols-outlined text-xs">close</span>
            </button>
          </div>
        )}

        {fileError && (
          <p className="text-[11px] text-red-500 mb-2 px-1">{fileError}</p>
        )}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.pptx,.ppt,.docx,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.html,.css"
          onChange={handleFileSelect}
        />

        {/* Prompt Card Box (Image 2) */}
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all p-2.5 space-y-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask Notion AI..."
            className="w-full bg-transparent border-0 resize-none outline-none text-xs text-on-surface placeholder:text-on-surface-variant/50 leading-relaxed max-h-36"
          />

          {/* Lower Action Row inside Card */}
          <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10 text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating || isParsingFile}
                className="w-6 h-6 rounded-md hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors disabled:opacity-40"
                title="Attach document or PDF"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
              </button>

              <span
                className="w-6 h-6 flex items-center justify-center text-on-surface-variant/60 cursor-help"
                title={import.meta.env.DEV
                  ? 'Your prompt goes from this Mac to Cloudflare Workers AI. The API token stays on this Mac.'
                  : 'Selected notes and requests are sent through Supabase to Cloudflare Workers AI'}
              >
                <span className="material-symbols-outlined text-[15px]">security</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-on-surface-variant/70">
                Auto
              </span>

              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={(!inputText.trim() && !attachedFile) || isGenerating || isParsingFile}
                className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
                aria-label="Send message"
              >
                <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
              </button>
            </div>
          </div>
        </div>
      </footer>
    </aside>
  );
}
