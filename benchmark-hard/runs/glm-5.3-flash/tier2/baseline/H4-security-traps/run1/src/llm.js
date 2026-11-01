// The one and only AI integration: the provided mock summarizer.
// Contract (from the mock's own docs): complete({ system, user }) -> Promise<string>.
import { complete } from '../llm.mock.js';

export { complete };
