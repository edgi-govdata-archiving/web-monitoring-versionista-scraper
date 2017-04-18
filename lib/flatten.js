'use strict';

module.exports = function (array) {
  return array.reduce((flattened, item) => flattened.concat(item), []);
};
