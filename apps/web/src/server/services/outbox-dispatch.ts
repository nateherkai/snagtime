export function shouldDrainOutboxInline(nodeEnv = process.env.NODE_ENV, requested = process.env.OUTBOX_INLINE_DRAIN) {
  return nodeEnv === "test" || (nodeEnv !== "production" && requested === "true");
}
