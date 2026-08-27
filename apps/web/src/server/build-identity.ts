export const compiledBuildId = process.env.TEMPOCOVE_COMPILED_BUILD_ID || "development";

export function assertCompiledBuildIdentity(runtimeBuildId = process.env.BUILD_ID, embeddedBuildId = compiledBuildId) {
  if (!/^[a-f0-9]{40,64}$/i.test(embeddedBuildId) || runtimeBuildId !== embeddedBuildId) {
    throw new Error("Runtime build identity does not match the immutable compiled artifact identity.");
  }
  return embeddedBuildId;
}
