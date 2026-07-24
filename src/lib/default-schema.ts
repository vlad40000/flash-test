export const DEFAULT_FLASH_THEME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    theme_schema_version: { type: 'string', enum: ['flash_theme_v4'] },
    suggested_title: { type: 'string' },
    style: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style_family: {
          type: 'string',
          enum: ['traditional', 'neo-traditional', 'blackwork', 'fine line', 'illustrative', 'realism', 'japanese', 'tribal', 'dotwork', 'engraving', 'ornamental', 'cartoon', 'animation', 'other', '[X]'],
        },
        rendering_finish: {
          type: 'string',
          enum: ['clean', 'painterly', 'semi-real', 'toon', 'flat graphic', 'textured', 'other', '[X]'],
        },
        line_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quality: { type: 'string', enum: ['crisp', 'sketchy', 'inked', 'rough', 'hand-drawn wobble', 'uniform', 'mixed', '[X]'] },
            outer_weight: { type: 'string', enum: ['thin', 'medium', 'thick', 'mixed', '[X]'] },
            interior_weight: { type: 'string', enum: ['none', 'thin', 'medium', 'thick', 'mixed', '[X]'] },
            hierarchy: { type: 'string' },
            edge_treatment: { type: 'string', enum: ['hard', 'soft', 'mixed', '[X]'] },
          },
          required: ['quality', 'outer_weight', 'interior_weight', 'hierarchy', 'edge_treatment'],
        },
        fill_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fill_behavior: { type: 'string' },
            color_separation: { type: 'string', enum: ['hard-separated', 'blended', 'layered', 'n-a', '[X]'] },
            gradient_policy: { type: 'string', enum: ['none', 'minimal', 'smooth', 'mixed', '[X]'] },
          },
          required: ['fill_behavior', 'color_separation', 'gradient_policy'],
        },
        shading_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            method: { type: 'string', enum: ['none', 'whip', 'pepper', 'smooth', 'hatch', 'stipple', 'mixed', '[X]'] },
            coverage: { type: 'string', enum: ['none', 'minimal', 'moderate', 'heavy', '[X]'] },
            contrast: { type: 'string', enum: ['n-a', 'low', 'medium', 'high', '[X]'] },
          },
          required: ['method', 'coverage', 'contrast'],
        },
        shape_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            geometry_bias: { type: 'string', enum: ['angular', 'rounded', 'organic', 'geometric', 'mixed', '[X]'] },
            proportion_treatment: { type: 'string' },
            silhouette_behavior: { type: 'string' },
          },
          required: ['geometry_bias', 'proportion_treatment', 'silhouette_behavior'],
        },
        detail_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            density: { type: 'string', enum: ['minimal', 'moderate', 'high', 'dense', '[X]'] },
            texture: { type: 'string', enum: ['none', 'film grain', 'paper grain', 'stipple texture', 'brushstroke', 'digital smooth', 'other', '[X]'] },
            interior_vs_exterior: { type: 'string' },
          },
          required: ['density', 'texture', 'interior_vs_exterior'],
        },
        palette_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            color_mode: { type: 'string', enum: ['monochrome', 'black-and-grey', 'full-color', '[X]'] },
            breadth: { type: 'string', enum: ['n-a', 'limited', 'broad', '[X]'] },
            saturation: { type: 'string', enum: ['n-a', 'muted', 'moderate', 'saturated', 'pastel', '[X]'] },
            value_contrast: { type: 'string', enum: ['low', 'medium', 'high', '[X]'] },
            colors: { type: 'array', maxItems: 12, items: { type: 'string' } },
            black_density: { type: 'string' },
          },
          required: ['color_mode', 'breadth', 'saturation', 'value_contrast', 'colors', 'black_density'],
        },
        composition_system: {
          type: 'object',
          additionalProperties: false,
          properties: {
            negative_space: { type: 'string' },
            background_treatment: { type: 'string', enum: ['transparent-canvas', 'white-canvas', 'neutral-flat-canvas', '[X]'] },
          },
          required: ['negative_space', 'background_treatment'],
        },
        visible_hand_characteristics: { type: 'string' },
      },
      required: ['style_family', 'rendering_finish', 'line_system', 'fill_system', 'shading_system', 'shape_system', 'detail_system', 'palette_system', 'composition_system', 'visible_hand_characteristics'],
    },
    theme: {
      type: 'object',
      additionalProperties: false,
      properties: {
        territory: { type: 'string' },
        era_cues: { type: 'string' },
        mood: { type: 'string' },
      },
      required: ['territory', 'era_cues', 'mood'],
    },
    quarantine: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject_roles: termArray(),
        identity_features: termArray(),
        clothing: termArray(),
        props: termArray(),
        symbols_and_text: termArray(),
        pose_and_action: termArray(),
        setting: termArray(),
        decorative_motifs: termArray(),
        source_specific_concepts: termArray(),
      },
      required: ['subject_roles', 'identity_features', 'clothing', 'props', 'symbols_and_text', 'pose_and_action', 'setting', 'decorative_motifs', 'source_specific_concepts'],
    },
  },
  required: ['theme_schema_version', 'suggested_title', 'style', 'theme', 'quarantine'],
} as const;

function termArray() {
  return { type: 'array', maxItems: 24, items: { type: 'string' } } as const;
}

export const DEFAULT_FLASH_THEME_SCHEMA_TEXT = JSON.stringify(DEFAULT_FLASH_THEME_SCHEMA, null, 2);
