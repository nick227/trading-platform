class PageTitleService {
  static #instance

  static getInstance() {
    if (!PageTitleService.#instance) {
      PageTitleService.#instance = new PageTitleService()
    }
    return PageTitleService.#instance
  }

  constructor() {
    this.appName = 'Lumantic Trading Platform'
    this.homeTitle = 'AI Trading Command Center'
  }

  setHomeTitle(homeTitle) {
    const resolvedHomeTitle = typeof homeTitle === 'string' ? homeTitle.trim() : ''
    if (resolvedHomeTitle) {
      this.homeTitle = resolvedHomeTitle
    }
  }

  setTitle(pageName, params = {}) {
    const parts = []
    const normalizedPageName = typeof pageName === 'string' ? pageName.trim() : ''

    if (!normalizedPageName || normalizedPageName.toLowerCase() === 'home') {
      parts.push(this.homeTitle)
    } else {
      parts.push(normalizedPageName)
    }

    const renderedParams = this.#formatParams(params)
    if (renderedParams) {
      parts.push(renderedParams)
    }

    parts.push(this.appName)
    document.title = parts.join(' | ')
  }

  setTitleFromSearch(pageName, search) {
    const params = Object.fromEntries(new URLSearchParams(search))
    this.setTitle(pageName, params)
  }

  #formatParams(params) {
    if (!params || typeof params !== 'object') return ''

    const entries = Object.entries(params)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => `${key}=${String(value).trim()}`)

    return entries.join(', ')
  }
}

const pageTitleService = PageTitleService.getInstance()

export default pageTitleService
