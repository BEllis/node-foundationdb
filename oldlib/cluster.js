/*
 * cluster.js
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

var future = require('./future');
var Database = require('./database');

var Cluster = function(_cluster) {
  this._cluster = _cluster;
  this.options = _cluster.options;

};

Cluster.prototype.openDatabase = function() {
  return new Database(this._cluster.openDatabase());
};

module.exports = Cluster;

