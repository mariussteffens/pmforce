/*
Copyright (c) Royal Holloway, University of London | Contact Blake Loring (blake@parsed.uk), Duncan Mitchell (Duncan.Mitchell.2015@rhul.ac.uk), or Johannes Kinder (johannes.kinder@rhul.ac.uk) for details or support
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const BinaryJumpTable = {
  "==": function(left, right) { return left == right; },
  "===": function(left, right) { return left === right; },

  "!=": function(left, right) { return left != right; },
  "!==": function(left, right) { return left !== right; },

  "<": function(left, right) { return left < right; },
  ">": function(left, right) { return left > right; },

  "<=": function(left, right) { return left <= right; },
  ">=": function(left, right) { return left >= right; },

  "+": function(left, right) { return left + right; },
  "-": function(left, right) { return left - right; },

  "*": function(left, right) { return left * right; },
  "/": function(left, right) { return left / right; },

  "%": function(left, right) { return left % right; },

  ">>": function(left, right) { return left >> right; },
  "<<": function(left, right) { return left << right; },
  ">>>": function(left, right) { return left >>> right; },

  "&": function(left, right) { return left & right; },
  "&&": function(left, right) { return left && right; },

  "|": function(l, r) { return l | r; },
  "||": function(l, r) { return l || r; },

  "^": function(l, r) { return l ^ r; },
  "instanceof": function(l, r) { return l instanceof r; },
  "in": function(l, r) { return l in r; }
};

const UnaryJumpTable = {
  "!": function(v) { return !v; },
  "~": function(v) { return ~v; },
  "-": function(v) { return -v; },
  "+": function(v) { return +v; },
  "typeof": function(v) { return typeof v; },
  "void": function(){return void 0}
};

export default {
  evalBinary: function(op, left, right) {
    return BinaryJumpTable[op](left, right);
  },

  evalUnary: function(op, left) {
    return UnaryJumpTable[op](left);
  }
};