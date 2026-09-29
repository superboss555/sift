#include <emscripten/bind.h>

int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    return a * b;
}

EMSCRIPTEN_BINDINGS(hello_module) {
    emscripten::function("add", &add);
    emscripten::function("multiply", &multiply);
}