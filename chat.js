            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "code-wrapper";

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const button = makeCopyButton(
            "Copy code",
            "Copied",
            pre.innerText
        );

        button.classList.add("copy-code");
        wrapper.appendChild(button);
    });

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyResponse = makeCopyButton(
        "Copy",
        "Copied",
        originalText
    );

    actions.appendChild(copyResponse);
    message.appendChild(actions);
}

let mathJaxFallbackLoading = false;

function loadMathJaxFallback() {
    if (mathJaxFallbackLoading) return;
    if (typeof MathJax !== "undefined" &&
        typeof MathJax.typesetPromise === "function") {
        return;
    }
