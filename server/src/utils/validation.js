function validateEventMetadata(typeOrMetadata, metadataArg) {
  const type = typeof typeOrMetadata === 'string' ? typeOrMetadata : metadataArg?.type ?? null
  const metadata = typeof typeOrMetadata === 'object' ? typeOrMetadata : (metadataArg ?? {})

  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Event metadata must be an object')
  }

  // We allow metadata for all valid BotEventType values
  return true
}

export { validateEventMetadata }
