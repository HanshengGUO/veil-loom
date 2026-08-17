# Protocol

The protocol package is the only contract shared by the browser and daemon. It contains exact
TypeBox schemas and TypeScript types without network, filesystem, React, Pi, or Veil dependencies.

The initial contract defines:

- session profiles and capabilities;
- assurance states and their allowed issuer;
- daemon health and profile discovery responses.

Future event envelopes will be versioned, sequenced per session, persisted before broadcast, and
replayable after reconnect. Large chart series will be referenced as immutable blobs rather than
repeated in an unbounded event log.

## Assurance

Loom may issue only `exploratory` assurance. Contract and Experiment states must be independently
derived from validated Veil records. The browser never infers assurance from a metric, process exit
code, model message, or visual similarity.
