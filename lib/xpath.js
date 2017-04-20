'use strict';

function xpath (node, expression) {
  const document = node.nodeType === node.DOCUMENT_NODE ? node : node.ownerDocument;
  const type = document.defaultView.XPathResult.ORDERED_NODE_ITERATOR_TYPE;
  const iterator = document.evaluate(expression, node, null, type, null);
  iterator.map = function (transform) {
    let item;
    let result = [];
    while (item = iterator.iterateNext()) {
      result.push(transform(item));
    }
    return result;
  }
  return iterator;
}

function xpathArray (node, expression) {
  return xpath(node, expression).map(item => item);
}

function xpathNode (node, expression) {
  const iterator = xpath(node, expression);
  return iterator.iterateNext();
}

module.exports = {
  xpath,
  xpathArray,
  xpathNode
};
