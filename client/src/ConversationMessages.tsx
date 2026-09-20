import type { DemoSnapshot } from './api';

// Message text, including acknowledgements, is supplied by the backend conversation layer.
export function ConversationMessages({ messages }: { messages: DemoSnapshot['lead']['messages'] }) {
  return <>{messages.map(message => <div className={`message ${message.sender === 'CUSTOMER' ? 'customer' : 'agent'}`} key={message.id}>
    <span className="message-label">{message.sender === 'CUSTOMER' ? 'הלקוח' : 'הסוכן'}</span>
    <div className="bubble">{message.text}</div>
  </div>)}</>;
}
