// Gaona-HUB: subtle bloom on saturated neon pixels near the footer.
// Original text stays sharp; white conversation text is excluded.
Texture2D shaderTexture;
SamplerState samplerState;
cbuffer PixelShaderSettings {
    float Time;
    float Scale;
    float2 Resolution;
    float4 Background;
};

float3 neon(float2 uv) {
    float3 rgb = shaderTexture.Sample(samplerState, saturate(uv)).rgb;
    float high = max(rgb.r, max(rgb.g, rgb.b));
    float low = min(rgb.r, min(rgb.g, rgb.b));
    float saturation = (high - low) / max(high, 0.001);
    return rgb * smoothstep(0.25, 0.5, saturation) * smoothstep(0.28, 0.65, high);
}

float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET {
    float4 original = shaderTexture.Sample(samplerState, tex);
    float mask = smoothstep(0.55, 0.72, tex.y);
    if (mask <= 0.0) return original;
    float2 step = max(Scale, 1.0) * 1.6 / Resolution;
    float3 bloom = neon(tex) * 0.25;
    bloom += (neon(tex + float2(step.x, 0)) + neon(tex - float2(step.x, 0))
            + neon(tex + float2(0, step.y)) + neon(tex - float2(0, step.y))) * 0.125;
    bloom += (neon(tex + step) + neon(tex - step)
            + neon(tex + float2(step.x, -step.y))
            + neon(tex + float2(-step.x, step.y))) * 0.0625;
    float2 wide = step * 2.5;
    bloom += (neon(tex + float2(wide.x, 0)) + neon(tex - float2(wide.x, 0))
            + neon(tex + float2(0, wide.y)) + neon(tex - float2(0, wide.y))) * 0.06;
    return float4(saturate(original.rgb + bloom * 0.58 * mask), original.a);
}
