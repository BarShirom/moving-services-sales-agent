import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessages } from '../src/ConversationMessages';
import { AgentState } from '../src/AgentState';
import type { DemoSnapshot } from '../src/api';
import { createLead } from '../../server/src/domain/createLead';
import { evaluateRequirements } from '../../server/src/domain/requirements/evaluateRequirements';

function snapshot(): DemoSnapshot {
  const lead = createLead();
  const requirements = evaluateRequirements(lead);
  const acknowledgement = 'אין בעיה, נמשיך בלי תמונה.';
  const responseText = `${acknowledgement} השלב הבא הוא בדיקה ותמחור על ידי הצוות.`;
  return { lead, requirements, extraction: {}, unappliedItems: [], acknowledgement, responseText,
    nextQuestion: { text: 'שאלה נפרדת שאינה התגובה המלאה', requirements: [] } };
}

test('chat renders the full backend response, including acknowledgement and next step', () => {
  const state = snapshot();
  state.lead.messages.push({ id: 'agent-message', sender: 'AGENT', timestamp: state.lead.createdAt, text: state.responseText });
  const html = renderToStaticMarkup(<ConversationMessages messages={state.lead.messages} />);
  assert.ok(html.includes(state.responseText));
  assert.ok(!html.includes(state.nextQuestion!.text));
});

test('agent response card uses responseText without reconstructing it from the next question', () => {
  const state = snapshot();
  const html = renderToStaticMarkup(<AgentState state={state} />);
  assert.ok(html.includes(state.responseText));
  assert.ok(!html.includes(state.nextQuestion!.text));
});

test('no next question still displays the backend handoff step', () => {
  const state = snapshot();
  state.nextQuestion = null;
  const html = renderToStaticMarkup(<AgentState state={state} />);
  assert.ok(html.includes('השלב הבא'));
  assert.ok(html.includes(state.responseText));
  assert.ok(!html.includes('אין כרגע שאלה נוספת'));
});
