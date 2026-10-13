import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_MAX_AGENT_ITERATIONS,
  DEFAULT_MAX_CONTINUATIONS,
  getMaxAgentIterations,
  getMaxContinuations,
} from '../config';

suite('Configuration Settings Test Suite', () => {
  test('default constants should have expected values', () => {
    assert.strictEqual(DEFAULT_MAX_AGENT_ITERATIONS, 10);
    assert.strictEqual(DEFAULT_MAX_CONTINUATIONS, 3);
  });

  test('getMaxAgentIterations should return a positive integer', () => {
    const iterations = getMaxAgentIterations();
    assert.strictEqual(typeof iterations, 'number');
    assert.ok(iterations >= 1, `Expected maxAgentIterations >= 1, got ${iterations}`);
  });

  test('getMaxContinuations should return a non-negative integer', () => {
    const continuations = getMaxContinuations();
    assert.strictEqual(typeof continuations, 'number');
    assert.ok(continuations >= 0, `Expected maxContinuations >= 0, got ${continuations}`);
  });

  test('package.json should contribute maxAgentIterations and maxContinuations configuration', () => {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    const properties = pkg.contributes?.configuration?.properties;
    assert.ok(properties, 'package.json should have contributes.configuration.properties');

    // maxAgentIterations check
    const agentIterConfig = properties['ooasis.maxAgentIterations'];
    assert.ok(agentIterConfig, 'ooasis.maxAgentIterations should be contributed in package.json');
    assert.strictEqual(agentIterConfig.type, 'integer');
    assert.strictEqual(agentIterConfig.default, 10);
    assert.strictEqual(agentIterConfig.minimum, 1);
    assert.ok(agentIterConfig.description, 'ooasis.maxAgentIterations should have a description');

    // maxContinuations check
    const continuationsConfig = properties['ooasis.maxContinuations'];
    assert.ok(continuationsConfig, 'ooasis.maxContinuations should be contributed in package.json');
    assert.strictEqual(continuationsConfig.type, 'integer');
    assert.strictEqual(continuationsConfig.default, 3);
    assert.strictEqual(continuationsConfig.minimum, 0);
    assert.ok(continuationsConfig.description, 'ooasis.maxContinuations should have a description');
  });
});
