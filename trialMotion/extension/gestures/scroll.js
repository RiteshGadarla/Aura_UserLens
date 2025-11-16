// Medium-smooth scroll handler — exposed globally as handleScroll
function handleScroll(data) {
    const amount = data?.amount ?? 0;
    console.log("[trailMotion] handleScroll amount:", amount);

    window.scrollBy({
        top: amount,
        behavior: "smooth"
    });
}

window.handleScroll = handleScroll;
