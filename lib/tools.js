/**
 * Create a comparison function composed from multiple simpler comparison. If
 * the first comparison is equal, it uses the second comparison, and so on.
 * @param  {...any} comparators comparison functions
 * @returns {(any, any) => int}
 * @example
 * [{x: 5, y: 2}, {x: 5, y: 3}, {x: 2, y: 4}].sort(compareMany(
 *   (a, b) => a.x - b.x,  // an explicit comparator
 *   ascend('y')           // using a convenience function
 * );
 * [{x: 5, y: 2}, {x: 5, y: 3}, {x: 2, y: 4}].sort(compareMany(
 *   ascend('x'),
 *   ascend(a => a.y)
 * );
 * [{x: 5, y: 2}, {x: 5, y: 3}, {x: 2, y: 4}].sort(compareMany(
 *   descend('x'),
 *   ascend('y')
 * );
 */
function compareMany (...comparators) {
  return (a, b) => {
    for (let comparator of comparators) {
      const result = comparator(a, b);
      if (result !== 0) return result;
    }
    return 0;
  }
}

/**
 * Create a comparison function that compares objects by the given property in
 * ascending order, with smaller values first.
 * @param {string|number|(any) => any} property Name of a property to compare
 *   by or a function that, given an object, returns a value to compare by.
 *   Strings and numbers are treated like the function: `x => x[property]`.
 * @returns {(any, any) => int}
 */
function ascend (property) {
  const getValue = getter(property);
  return (a, b) => {
    const valueA = getValue(a), valueB = getValue(b);
    if (valueA < valueB) return -1;
    if (valueA > valueB) return 1;
    return 0;
  }
}

/**
 * Create a comparison function that compares objects by the given property in
 * descending order, with larger values first.
 * @param {string|number|(any) => any} property Name of a property to compare
 *   by or a function that, given an object, returns a value to compare by.
 *   Strings and numbers are treated like the function: `x => x[property]`.
 * @returns {(any, any) => int}
 */
function descend (property) {
  const comparator = ascend(property);
  return (a, b) => -1 * comparator(a, b);
}

/**
 * Create a function that takes an object and returns a value from:
 * - `string|number` indicating the name of the property to return
 * - `function` identical to the sort this function returns (if this is what
 *    you pass in, you'll just get it right back).
 * @param {string|number|(item) => any} key Property to get
 * @returns {(any) => any}
 */
function getter (key) {
  if (typeof key === 'function') return key;
  return x => x[key];
}

/**
 * Traverse an object by a series of properties to get a deeply nested value.
 * @param {any} object
 * @param  {...(string|number)} properties A list of properties to get
 */
function getDeep (object, ...properties) {
  return properties.reduce((parent, key) => (parent != null ? parent[key] : null), object);
}

module.exports = {
  compareMany,
  ascend,
  descend,
  getter,
  getDeep
}
