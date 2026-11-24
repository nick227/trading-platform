export class BaseLLMProvider {
  constructor(name) {
    this.name = name
  }

  /**
   * Generates a structured JSON response from the model.
   * @param {object} options
   * @param {string} options.systemPrompt
   * @param {string} options.userPrompt
   * @param {object} [options.schema]
   * @param {string} [options.model]
   * @param {number} [options.temperature]
   * @returns {Promise<{ structured: object, rawText: string, model: string, usage: object }>}
   */
  async completeStructured() {
    throw new Error('completeStructured must be implemented by subclass')
  }
}
