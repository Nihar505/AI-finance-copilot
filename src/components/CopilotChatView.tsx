import React, { useState } from 'react';
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  AlertCircle, 
  Key
} from 'lucide-react';

interface CopilotChatViewProps {
  onQueryCopilot: (question: string) => Promise<any>;
  isLoading: boolean;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  facts?: string[];
  observations?: string[];
  citations?: any[];
  missingInfoNotice?: string | null;
  modelUsed?: string;
}

export const CopilotChatView: React.FC<CopilotChatViewProps> = ({
  onQueryCopilot,
  isLoading
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your AI Finance & Compliance Copilot. I answer questions strictly grounded in your loaded PostgreSQL ledger records, bank statements, invoices, and bills. I never invent figures or speculate beyond your data.',
      facts: [
        'Connected to Organization: Apex Global Advisory & Co.',
        'Enforcing strict human-in-the-loop guardrails: All answers cite specific transaction IDs.'
      ],
      observations: [
        'Ask me about monthly expenses, unpaid invoices, duplicate transactions, or specific counterparties.'
      ],
      modelUsed: 'grounded-ledger-engine'
    }
  ]);
  const [inputQuery, setInputQuery] = useState('');

  const samplePrompts = [
    'What are our top largest expenses this month?',
    'Show all duplicate transactions and risk exceptions',
    'Which sales invoices remain unpaid and outstanding?',
    'Summarize cash flows and approved ledger revenue',
    'What transactions were recorded for Uber and AWS?'
  ];

  const handleSend = async (questionText?: string) => {
    const q = (questionText || inputQuery).trim();
    if (!q || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: q
    };

    setMessages(prev => [...prev, userMsg]);
    setInputQuery('');

    try {
      const res = await onQueryCopilot(q);
      const copilotData = res?.data;

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: 'assistant',
        text: copilotData?.directAnswer || 'Analysis complete.',
        facts: copilotData?.facts || [],
        observations: copilotData?.observations || [],
        citations: copilotData?.citations || [],
        missingInfoNotice: copilotData?.missingInfoNotice || null,
        modelUsed: copilotData?.modelUsed || 'grounded-ledger-engine'
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          sender: 'assistant',
          text: `Error processing query: ${err.message || 'Please verify database connection.'}`
        }
      ]);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Grounded AI Financial Copilot
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Strictly grounded Q&amp;A over loaded transactions and documents. Guaranteed zero hallucinations with verifiable citations.
          </p>
        </div>

        <div className="pill pill-rule">
          <Key size={11} />
          <span>Deterministic Grounded Fallback Active</span>
        </div>
      </div>

      {/* Suggested Prompt Chips */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '14px' }}>
        {samplePrompts.map((prompt, idx) => (
          <button
            key={idx}
            className="btn btn-secondary btn-sm"
            style={{ whiteSpace: 'nowrap', fontSize: '11.5px' }}
            onClick={() => handleSend(prompt)}
            disabled={isLoading}
          >
            <Sparkles size={11} />
            <span>{prompt}</span>
          </button>
        ))}
      </div>

      {/* Chat Container */}
      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((m) => {
            const isUser = m.sender === 'user';

            return (
              <div key={m.id} className={`chat-bubble ${isUser ? 'user' : 'assistant'}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  {isUser ? (
                    <>
                      <User size={13} />
                      <strong style={{ fontSize: '12px' }}>Chartered Accountant</strong>
                    </>
                  ) : (
                    <>
                      <Bot size={14} />
                      <strong style={{ fontSize: '12px', color: '#ffffff' }}>Financial Copilot</strong>
                      {m.modelUsed && (
                        <span className="pill pill-rule" style={{ fontSize: '9.5px', marginLeft: 'auto' }}>
                          {m.modelUsed}
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  {m.text}
                </div>

                {/* Direct Verified Facts */}
                {m.facts && m.facts.length > 0 && (
                  <div style={{ marginTop: '12px', background: 'rgba(255, 255, 255, 0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                      Verified Ledger Facts
                    </div>
                    <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {m.facts.map((f, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Observations & Caveats */}
                {m.observations && m.observations.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Observations: </strong>
                    {m.observations.join(' ')}
                  </div>
                )}

                {/* Missing Info Warning */}
                {m.missingInfoNotice && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#ffffff' }}>
                    <AlertCircle size={12} />
                    <span>{m.missingInfoNotice}</span>
                  </div>
                )}

                {/* Citations Box */}
                {m.citations && m.citations.length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                      Grounded Ledger Citations:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {m.citations.map((c, i) => (
                        <span key={i} className="pill pill-rule" style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>
                          #{c.id || c.source} · {c.counterparty || c.code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Input Bar */}
        <div className="chat-input-bar">
          <input
            type="text"
            className="chat-input"
            placeholder="Ask anything about transactions, invoices, taxes, or reconciliations..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={() => handleSend()}
            disabled={isLoading || !inputQuery.trim()}
          >
            <Send size={13} />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
