// The YAML language worker. Loaded through this entry, not monaco-yaml's file directly, so Vite
// pre-bundles it in development: its CommonJS dependencies fail in a module worker otherwise.
import 'monaco-yaml/yaml.worker.js';
