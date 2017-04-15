'use strict';

// Accepted for ES-2017, so safe to use
if (!String.prototype.padStart) {
  Object.defineProperty(String.prototype, 'padStart', {
    enumerable: false,
    value: function (length, padString = ' ') {
      const addLength = length - this.length;
      if (addLength > 0) {
        return padString.repeat(addLength).slice(0, addLength) + this;
      }
      return this;
    }
  });
  Object.defineProperty(String.prototype, 'padEnd', {
    enumerable: false,
    value: function (length, padString = ' ') {
      const addLength = length - this.length;
      if (addLength > 0) {
        return this + padString.repeat(addLength).slice(0, addLength);
      }
      return this;
    }
  });
}
