import { useState, useEffect, useRef } from 'react';
import {
  getStoredChats,
  createNewAIChat,
  addMessageToChat
} from '../lib/aiChatStore.js';
import { chatWithMotionAI } from '../lib/motionAI.js';
import { parseAttachedDocument } from '../lib/documentParser.js';

function renderMarkdownSnippet(text) {
  if (!text) return null;

  // Split into paragraphs / code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const firstLineBreak = part.indexOf('\n');
      const lang = firstLineBreak !== -1 ? part.slice(3, firstLineBreak).trim() : '';
      const code = firstLineBreak !== -1 ? part.slice(firstLineBreak + 1, -3) : part.slice(3, -3);

      return (
        <div key={index} className="my-3 rounded-lg overflow-hidden border border-outline-variant/20 bg-[#1e1e1e] text-stone-100 text-xs">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] text-stone-300 border-b border-white/5 font-mono">
            <span>{lang || 'code'}</span>
            <button
              type="button"
              className="text-[11px] hover:text-white transition-colors"
              onClick={() => navigator.clipboard.writeText(code)}
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

    // Process headers and bold/lists
    const lines = part.split('\n');
    return (
      <div key={index} className="space-y-1.5 leading-relaxed">
        {lines.map((line, lIdx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('### ')) {
            return <h4 key={lIdx} className="font-bold text-sm mt-3 mb-1 text-on-surface">{trimmed.replace('### ', '')}</h4>;
          }
          if (trimmed.startsWith('## ')) {
            return <h3 key={lIdx} className="font-bold text-base mt-4 mb-1.5 text-on-surface">{trimmed.replace('## ', '')}</h3>;
          }
          if (trimmed.startsWith('# ')) {
            return <h2 key={lIdx} className="font-bold text-lg mt-4 mb-2 text-on-surface">{trimmed.replace('# ', '')}</h2>;
          }
          if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
            return (
              <li key={lIdx} className="ml-4 list-disc text-sm text-on-surface-variant">
                {formatInline(trimmed.slice(2))}
              </li>
            );
          }
          if (/^\d+\.\s/.test(trimmed)) {
            return (
              <p key={lIdx} className="text-sm text-on-surface-variant font-medium">
                {formatInline(trimmed)}
              </p>
            );
          }
          if (!trimmed) {
            return <div key={lIdx} className="h-2" />;
          }
          return <p key={lIdx} className="text-sm text-on-surface-variant">{formatInline(line)}</p>;
        })}
      </div>
    );
  });
}

function formatInline(str) {
  const tokens = str.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={i} className="font-bold text-on-surface">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded bg-surface-container-high font-mono text-xs text-primary font-semibold">
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}

export default function AIChatView({ activeChatId, onSelectChat, workspace, user }) {
  const [chats, setChats] = useState(getStoredChats);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [fileError, setFileError] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const handleUpdate = () => {
      setChats(getStoredChats());
    };
    window.addEventListener('motion:ai-chats-updated', handleUpdate);
    return () => window.removeEventListener('motion:ai-chats-updated', handleUpdate);
  }, []);

  const currentChat = chats.find((c) => c.id === activeChatId) || chats[0];

  useEffect(() => {
    if (!activeChatId && chats.length > 0) {
      onSelectChat?.(chats[0].id);
    }
  }, [activeChatId, chats, onSelectChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages, isGenerating, isParsingFile]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setIsParsingFile(true);

    try {
      const parsedDoc = await parseAttachedDocument(file);
      setAttachedFile(parsedDoc);

      // Pre-fill a helpful prompt suggestion if empty
      if (!inputText.trim()) {
        if (parsedDoc.fileType === 'pdf') {
          setInputText(`Please summarize the PDF document "${file.name}" and extract key takeaways.`);
        } else if (parsedDoc.fileType === 'pptx') {
          setInputText(`Please summarize the PowerPoint presentation "${file.name}" and explain the slides.`);
        } else {
          setInputText(`Please read and summarize the document "${file.name}" and highlight key concepts.`);
        }
      }
    } catch (err) {
      console.error('File parsing error:', err);
      setFileError(err.message || 'Error occurred while reading the document.');
    } finally {
      setIsParsingFile(false);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  }

  async function handleSendMessage(promptText, overrideFile = null) {
    const fileToUpload = overrideFile !== null ? overrideFile : attachedFile;
    const baseText = (promptText || inputText).trim();

    if (!baseText && !fileToUpload) return;
    if (isGenerating || isParsingFile) return;

    const textToSend = baseText || (fileToUpload ? `Please read and analyze "${fileToUpload.name}" and provide a comprehensive summary and key takeaways.` : '');

    let targetChatId = currentChat?.id;
    if (!targetChatId) {
      const chatTitle = fileToUpload ? `📄 ${fileToUpload.name}` : 'New chat';
      const newChat = createNewAIChat(chatTitle);
      targetChatId = newChat.id;
      onSelectChat?.(newChat.id);
    }

    // Save user message with file badge if attached
    addMessageToChat(targetChatId, {
      sender: 'user',
      text: textToSend,
      fileName: fileToUpload?.name || null,
      fileTypeLabel: fileToUpload?.fileTypeLabel || null,
      fileIcon: fileToUpload?.icon || null
    });

    setAttachedFile(null);
    setInputText('');
    setFileError('');
    setIsGenerating(true);

    try {
      const aiResponseText = await chatWithMotionAI({
        messages: currentChat?.messages || [],
        newUserPrompt: textToSend,
        attachedFile: fileToUpload,
        workspaceContext: workspace
      });

      addMessageToChat(targetChatId, {
        sender: 'ai',
        text: aiResponseText
      });
    } catch (err) {
      console.error('AI chat error:', err);
      addMessageToChat(targetChatId, {
        sender: 'ai',
        text: `### AI Assistant Notice\n${err.message || 'AI is unavailable. Please try again later.'}`
      });
    } finally {
      setIsGenerating(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleStartNewChat() {
    const newChat = createNewAIChat('New chat');
    onSelectChat?.(newChat.id);
    setAttachedFile(null);
    setFileError('');
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // Pre-configured quick action prompts for attached files
  const fileQuickActions = [
    {
      title: '📑 Comprehensive Summary',
      desc: 'Summary of core concepts and key findings',
      prompt: 'Please provide a comprehensive and detailed summary of this document, extracting the most important concepts, key definitions, and notable conclusions in an organized format.'
    },
    {
      title: '🎯 Exam & Quiz Questions',
      desc: 'MCQ, True/False, and conceptual questions with answers',
      prompt: 'Generate a comprehensive exam quiz based on this document: include multiple choice questions (MCQ) with 4 choices, True/False questions with justifications, and short-answer questions, providing the answer key and explanations at the end.'
    },
    {
      title: '💡 Core Concepts Explained',
      desc: 'Simplified explanations of key definitions and principles',
      prompt: 'Explain the core concepts, terminologies, and definitions in this document in an educational, easy-to-understand manner with illustrative examples.'
    },
    {
      title: '❓ Quick Revision Q&A',
      desc: '10 focused questions and answers for fast review',
      prompt: 'Extract the top 10 high-yield questions and answers (Q&A) for rapid exam preparation based on the content of this document.'
    }
  ];

  const starterPrompts = [
    {
      title: 'Analyze & Summarize PDF or Slides',
      prompt: 'Upload a PDF or PowerPoint presentation for instant summary and explanation',
      action: () => fileInputRef.current?.click()
    },
    {
      title: 'Generate Practice Exam & Quiz',
      prompt: 'Create a question bank with answer keys and explanations from your study materials',
      action: () => fileInputRef.current?.click()
    },
    {
      title: 'Schema & Tables Overview',
      prompt: 'Explain the database schema, core tables, and relationships in the project',
      action: () => handleSendMessage('Explain the database schema, core tables, and relationships in the project')
    },
    {
      title: 'Project Action Plan',
      prompt: 'Create an actionable project plan with a timeline, milestones, and task breakdown',
      action: () => handleSendMessage('Create an actionable project plan with a timeline, milestones, and task breakdown')
    }
  ];

  function getFileIcon(type, icon) {
    if (icon) return icon;
    if (type === 'pdf') return 'picture_as_pdf';
    if (type === 'pptx') return 'slideshow';
    if (type === 'docx') return 'article';
    return 'description';
  }

  function getFileColor(type) {
    if (type === 'pdf') return 'text-red-500 bg-red-500/10 border-red-500/20';
    if (type === 'pptx') return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    if (type === 'docx') return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
    return 'text-primary bg-primary/10 border-primary/20';
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-surface text-on-surface">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-outline-variant/15 bg-surface-container-lowest">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
            <span className="material-symbols-outlined text-base">auto_awesome</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-on-surface flex items-center gap-2">
              {currentChat?.title || 'Motion AI'}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Workers AI Free • PDF &amp; Slides
              </span>
            </h2>
            <p className="text-[11px] text-on-surface-variant">
              PDF &amp; Presentation Analysis • Exam Generation • Intelligent Workspace Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-on-primary hover:opacity-90 transition-opacity shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New chat
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
        {(!currentChat?.messages || currentChat.messages.length === 0) ? (
          <div className="max-w-2xl mx-auto py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4 shadow-inner">
              <span className="material-symbols-outlined text-3xl">auto_awesome</span>
            </div>
            <h3 className="text-xl font-bold text-on-surface mb-2">How can I help you today?</h3>
            <p className="text-sm text-on-surface-variant mb-8 max-w-md mx-auto">
              Upload a PDF, PowerPoint presentation, or document to summarize, ask questions, or generate instant exam quizzes.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              {starterPrompts.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={item.action}
                  className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest hover:bg-surface-container-high transition-colors text-left group"
                >
                  <p className="text-xs font-semibold text-primary mb-1 flex items-center justify-between">
                    {item.title}
                    <span className="material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 transition-opacity">arrow_forward</span>
                  </p>
                  <p className="text-xs text-on-surface-variant line-clamp-2">{item.prompt}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            {currentChat.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'ai' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5 border border-primary/20">
                    <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-primary text-on-primary rounded-br-sm'
                      : 'bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-bl-sm'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <div>
                      {msg.fileName && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/25 text-xs font-medium mb-2 border border-white/10 shadow-xs">
                          <span className="material-symbols-outlined text-sm">
                            {getFileIcon(msg.fileType, msg.fileIcon)}
                          </span>
                          <span className="font-semibold">{msg.fileName}</span>
                          {msg.fileTypeLabel && (
                            <span className="text-[10px] opacity-80 border-l border-white/20 pl-1.5 ml-0.5">
                              {msg.fileTypeLabel}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    </div>
                  ) : (
                    <div>
                      {renderMarkdownSnippet(msg.text)}
                      <div className="mt-3 pt-2 border-t border-outline-variant/10 flex items-center justify-end gap-2 text-xs text-on-surface-variant">
                        <button
                          type="button"
                          className="hover:text-primary transition-colors flex items-center gap-1"
                          onClick={() => {
                            navigator.clipboard.writeText(msg.text);
                          }}
                        >
                          <span className="material-symbols-outlined text-xs">content_copy</span>
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {msg.sender === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                    {user?.email ? user.email.slice(0, 2).toUpperCase() : 'ME'}
                  </div>
                )}
              </div>
            ))}

            {isGenerating && (
              <div className="flex gap-3.5 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                </div>
                <div className="rounded-2xl px-4 py-3 bg-surface-container-lowest border border-outline-variant/15 rounded-bl-sm text-sm text-on-surface-variant flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce"></span>
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-xs text-on-surface-variant ml-1 font-medium">Motion AI is analyzing the document and drafting a response...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="p-4 border-t border-outline-variant/15 bg-surface-container-lowest">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* File Error Alert */}
          {fileError && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">error</span>
                <span>{fileError}</span>
              </div>
              <button
                type="button"
                onClick={() => setFileError('')}
                className="hover:opacity-75"
              >
                <span className="material-symbols-outlined text-xs">close</span>
              </button>
            </div>
          )}

          {/* Attached File Preview Card */}
          {attachedFile && (
            <div className="p-3 rounded-xl bg-surface-container-high border border-outline-variant/30 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${getFileColor(attachedFile.fileType)}`}>
                    <span className="material-symbols-outlined text-lg">
                      {getFileIcon(attachedFile.fileType, attachedFile.icon)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-on-surface truncate">
                      {attachedFile.name}
                    </p>
                    <p className="text-[10px] text-on-surface-variant flex items-center gap-1.5">
                      <span className="font-medium text-primary">{attachedFile.fileTypeLabel}</span>
                      <span>•</span>
                      <span>{(attachedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                      {attachedFile.stats?.slidesCount && (
                        <>
                          <span>•</span>
                          <span className="bg-amber-500/15 text-amber-500 px-1 rounded font-semibold">
                            {attachedFile.stats.slidesCount} slides
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  className="text-on-surface-variant hover:text-red-500 p-1 rounded-md hover:bg-surface-container-highest transition-colors"
                  title="Remove attached file"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              {/* Quick Actions for this file */}
              <div className="pt-2 border-t border-outline-variant/15">
                <p className="text-[11px] font-semibold text-on-surface-variant mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-primary">tips_and_updates</span>
                  Quick actions for this file (click to send):
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {fileQuickActions.map((qa, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={isGenerating || isParsingFile}
                      onClick={() => handleSendMessage(qa.prompt, attachedFile)}
                      className="p-1.5 rounded-lg border border-outline-variant/20 bg-surface hover:bg-primary/10 hover:border-primary/40 transition-all text-left text-xs group disabled:opacity-50"
                      title={qa.desc}
                    >
                      <div className="font-semibold text-on-surface text-[11px] group-hover:text-primary transition-colors">
                        {qa.title}
                      </div>
                      <div className="text-[9px] text-on-surface-variant truncate">
                        {qa.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Parsing Spinner */}
          {isParsingFile && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-base text-primary animate-spin">progress_activity</span>
              <span>Reading and extracting document content... Please wait</span>
            </div>
          )}

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.pptx,.ppt,.docx,.txt,.md,.json,.csv,.py,.js,.jsx,.ts,.tsx,.html,.css,.sql"
            onChange={handleFileSelect}
          />

          {/* Main Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-end gap-2 p-2 rounded-xl border border-outline-variant/25 bg-surface focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 transition-all shadow-sm"
          >
            {/* File Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating || isParsingFile}
              className="w-9 h-9 rounded-lg border border-outline-variant/20 text-on-surface-variant hover:text-primary hover:bg-surface-container-high flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50"
              title="Attach PDF, PowerPoint presentation, or document to analyze"
            >
              <span className="material-symbols-outlined text-lg">attach_file</span>
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                attachedFile
                  ? "Ask a question about the document, or pick a quick action above..."
                  : "Ask anything, or attach a document for instant analysis..."
              }
              className="flex-1 bg-transparent border-0 resize-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 px-2 py-1 max-h-32 leading-relaxed"
            />

            <button
              type="submit"
              disabled={(!inputText.trim() && !attachedFile) || isGenerating || isParsingFile}
              className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0"
              aria-label="Send message"
            >
              <span className="material-symbols-outlined text-base">arrow_upward</span>
            </button>
          </form>

          <p className="text-[10px] text-center text-on-surface-variant/60">
            Powered by Cloudflare Workers AI Free • Supports text-based PDFs, PowerPoint presentations, and documents for analysis and quiz generation
          </p>
        </div>
      </div>
    </div>
  );
}

