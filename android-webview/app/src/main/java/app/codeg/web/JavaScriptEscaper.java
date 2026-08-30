package app.codeg.web;

final class JavaScriptEscaper {
    private JavaScriptEscaper() {}

    static String quote(String value) {
        StringBuilder output = new StringBuilder(value.length() + 16);
        output.append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\f' -> output.append("\\f");
                case '\n' -> output.append("\\n");
                case '\r' -> output.append("\\r");
                case '\t' -> output.append("\\t");
                default -> {
                    if (character < 0x20
                            || character == '<'
                            || character == '>'
                            || character == '&'
                            || character == '\u2028'
                            || character == '\u2029') {
                        output.append(String.format("\\u%04x", (int) character));
                    } else {
                        output.append(character);
                    }
                }
            }
        }
        output.append('"');
        return output.toString();
    }
}
