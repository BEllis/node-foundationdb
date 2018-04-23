#!/usr/bin/env node

/*
 * promise_aplus_test.js
 *
 * This source file is part of the FoundationDB open source project
 *
 * Copyright 2013-2018 Apple Inc. and the FoundationDB project authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

var promisesAplusTests = require('promises-aplus-tests');
var future = require('../lib/future.js');

var adapter = {
	resolved: function(value) {
		var f = future.create();
		f._state.fulfill(value);
		return f;
	},

	rejected: function(reason) {
		var f = future.create();
		f._state.reject(reason);
		return f;
	},

	deferred: function() {
		var f = future.create();

		return {
			promise: f,
			resolve: function(value) {
				f._state.fulfill(value);
			},
			reject: function(reason) {
				f._state.reject(reason);
			},
		};
	}
};

promisesAplusTests(adapter, function(err) {
	console.log('Finished tests:', err);
});
